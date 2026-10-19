import http from 'node:http';
import {HttpError,MAX_BYTES,validUserId} from './validation.mjs';

function send(res,status,value,close = false) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(close ? {'Connection':'close'} : {}),...(status === 401 ? {'WWW-Authenticate':'Bearer'} : {}),...(status === 429 ? {'Retry-After':'60'} : {})});
  res.end(JSON.stringify(value));
}
function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) throw new HttpError(415,'Use uncompressed application/json');
  if (Number(req.headers['content-length'] || 0) > MAX_BYTES) throw new HttpError(413,'Request is too large');
  return new Promise((resolve,reject) => {
    const chunks = []; let size = 0, failed = false;
    req.on('data',chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BYTES) { failed = true; reject(new HttpError(413,'Request is too large')); return; }
      chunks.push(chunk);
    });
    req.on('end',() => {
      if (failed) return;
      try { resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))); }
      catch { reject(new HttpError(400,'Invalid JSON')); }
    });
    req.on('aborted',() => reject(new HttpError(400,'Request aborted')));
    req.on('error',() => reject(new HttpError(400,'Request failed')));
  });
}

export function createApp(store,{authFailureLimit = 30} = {}) {
  const failures = new Map();
  function blocked(address) {
    const item = failures.get(address);
    if (item && item.expires <= Date.now()) { failures.delete(address); return false; }
    return item?.count >= authFailureLimit;
  }
  function recordFailure(address) {
    if (failures.size >= 4096) failures.delete(failures.keys().next().value);
    const old = failures.get(address);
    failures.set(address,{count:(old?.expires > Date.now() ? old.count : 0)+1,expires:old?.expires > Date.now() ? old.expires : Date.now()+60000});
  }
  const server = http.createServer({maxHeaderSize:16384},async(req,res) => {
    try {
      const pathname = req.url?.split('?')[0];
      if (pathname === '/healthz' && req.method === 'GET') {
        store.db.prepare('SELECT 1').get(); send(res,200,{ok:true}); return;
      }
      const match = /^\/api\/v1\/users\/([A-Za-z0-9._-]{1,64})\/sync$/.exec(pathname || '');
      if (!match || !validUserId(match[1])) throw new HttpError(404,'Not found');
      if (!['GET','PUT'].includes(req.method)) { res.setHeader('Allow','GET, PUT'); throw new HttpError(405,'Method not allowed'); }
      const address = req.socket.remoteAddress || 'unknown';
      if (blocked(address)) throw new HttpError(429,'Too many authentication failures; retry later');
      const authorization = req.headers.authorization || '';
      const token = /^Bearer ([\x21-\x7e]{1,2048})$/i.exec(authorization)?.[1];
      try { if (!token) throw new HttpError(401,'Authentication failed'); store.authenticate(match[1],token); }
      catch (error) { if (error.status === 401) recordFailure(address); throw error; }
      if (req.method === 'GET') send(res,200,store.read(match[1],token));
      else send(res,200,store.write(match[1],token,await readJson(req)));
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      const busy = error.errcode === 5 || error.errcode === 6;
      const status = error instanceof HttpError ? error.status : busy ? 503 : 500;
      if (status === 500) console.error('Request failed:',error.code || 'internal');
      send(res,status,{error:error instanceof HttpError ? error.message : busy ? 'Database busy; retry later' : 'Internal server error'},true);
      req.resume();
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  return server;
}
