import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {Store,restoreBackup} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
import {validateData,MAX_BYTES} from '../src/validation.mjs';

const data = (text = '完成方案') => ({tasks:[{id:'one',text,done:false,collapsed:false,groupId:'daily',children:[{id:'two',text:'资料',done:true,collapsed:false,children:[{id:'three',text:'文件',done:false,collapsed:false,children:[]}]}],reminder:'2026-10-20T17:55',reminderAt:'2026-10-20T09:55:00.000Z',repeat:'workday',repeatSeries:'series',repeatAnchor:'2026-10-19T09:55:00.000Z',repeatIndex:1,repeatArchived:false,childListStyle:'lower-alpha'}],groups:[{id:'daily',name:'日常',color:'#4b9b72',collapsed:false}],taskPlacement:{level1:'top',level2:'bottom',level3:'bottom'}});
const upload = (snapshot,value = data()) => ({schemaVersion:1,serverId:snapshot.serverId,baseRevision:snapshot.revision,data:value});
function fixture(t,options) {
  const folder = mkdtempSync(path.join(tmpdir(),'todo-server-test-'));
  const store = new Store(path.join(folder,'data'),options);
  t.after(() => {store.close();rmSync(folder,{recursive:true,force:true});});
  return {folder,store};
}
async function listening(t,store,options) {
  const server = createApp(store,options);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections();server.close(resolve);}));
  return {server,url:'http://127.0.0.1:'+server.address().port};
}
async function request(url,user,token,method = 'GET',body) {
  const response = await fetch(url+'/api/v1/users/'+user+'/sync',{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)});
  return {status:response.status,headers:response.headers,body:await response.json()};
}

test('authentication, user isolation, exact task metadata, empty snapshot and history',async t => {
  const {store} = fixture(t,{historyLimit:2}), alice = store.addUser('alice'), bob = store.addUser('bob');
  const {url} = await listening(t,store);
  const empty = await request(url,'alice',alice.token);
  assert.equal(empty.status,200);assert.equal(empty.body.revision,0);assert.equal(empty.body.data,null);assert.equal(empty.body.updatedAt,null);
  assert.equal(empty.headers.get('cache-control'),'no-store');
  assert.equal((await request(url,'bob',alice.token)).status,401);
  assert.equal((await request(url,'alice','bad-token')).status,401);
  const first = await request(url,'alice',alice.token,'PUT',upload(empty.body));
  assert.equal(first.status,200);assert.equal(first.body.revision,1);assert.deepEqual(first.body.data,data());
  assert.deepEqual((await request(url,'alice',alice.token)).body,first.body);
  assert.equal((await request(url,'bob',bob.token)).body.data,null);
  assert.equal((await request(url,'alice',alice.token,'PUT',upload(empty.body,data('stale')))).status,409);
  assert.equal((await request(url,'alice',alice.token,'PUT',{...upload(first.body),serverId:'another-instance'})).status,409);
  let snapshot = first.body;
  for (let i=0;i<3;i++) snapshot = (await request(url,'alice',alice.token,'PUT',upload(snapshot,data('修改'+i)))).body;
  assert.deepEqual(store.history('alice').map(item=>item.revision),[3,2]);
  assert.equal(store.exportHistory('alice',2).data.tasks[0].text,'修改0');
  const cleared = {tasks:[],groups:[],taskPlacement:{level1:'top',level2:'bottom',level3:'bottom'}};
  const clearResult = await request(url,'alice',alice.token,'PUT',upload(snapshot,cleared));
  assert.equal(clearResult.status,200);assert.equal(clearResult.body.revision,5);assert.deepEqual(clearResult.body.data,cleared);
  assert.equal(store.listUsers().some(user=>Object.hasOwn(user,'token_hash')),false);
});

test('two devices racing on one revision cannot overwrite each other',async t => {
  const {store} = fixture(t), alice = store.addUser('alice'), {url} = await listening(t,store);
  const initial = (await request(url,'alice',alice.token)).body;
  const results = await Promise.all(['设备A','设备B'].map(name=>request(url,'alice',alice.token,'PUT',upload(initial,data(name)))));
  assert.deepEqual(results.map(item=>item.status).sort(),[200,409]);
  assert.equal((await request(url,'alice',alice.token)).body.revision,1);
});

test('malformed and oversized uploads leave the previous revision intact',async t => {
  const {store} = fixture(t), alice = store.addUser('alice'), {url} = await listening(t,store);
  const current = store.read('alice',alice.token);
  const badValues = [];
  let value = data();value.tasks[0].children[0].id='one';badValues.push(value);
  value=data();value.tasks[0].children[0].children[0].children=[{id:'four',text:'too deep',done:false,collapsed:false,children:[]}];badValues.push(value);
  value=data();value.tasks[0].groupId='missing';badValues.push(value);
  value=data();value.tools=[{path:'C:/local.txt'}];badValues.push(value);
  value=data();value.tasks[0].remindedAt='local-only';badValues.push(value);
  value=data();value.tasks[0].repeat='unsupported';badValues.push(value);
  value=data();value.groups[0].color=['#4b9b72'];badValues.push(value);
  value=data();value.taskPlacement.level1='wrong';badValues.push(value);
  for (const item of badValues) assert.equal((await request(url,'alice',alice.token,'PUT',upload(current,item))).status,400);
  const raw = (body,headers={}) => fetch(url+'/api/v1/users/alice/sync',{method:'PUT',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json',...headers},body});
  assert.equal((await raw('{broken')).status,400);
  assert.equal((await raw('{}',{'Content-Type':'text/plain'})).status,415);
  assert.equal((await raw(JSON.stringify({...upload(current),schemaVersion:2}))).status,400);
  assert.equal((await raw(' '.repeat(MAX_BYTES+1))).status,413);
  assert.equal(store.read('alice',alice.token).revision,0);
  // Chunked bodies must be limited even when Content-Length is absent.
  const chunkedStatus = await new Promise((resolve,reject)=>{
    const req=http.request(url+'/api/v1/users/alice/sync',{method:'PUT',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);for(let i=0;i<65;i++)req.write(' '.repeat(65536));req.end();
  });
  assert.equal(chunkedStatus,413);
  const many=data();many.tasks=Array.from({length:10001},(_,i)=>({id:String(i),text:'x',done:false,collapsed:false,children:[]}));assert.throws(()=>validateData(many));
});

test('disable and rotate revoke old tokens without losing tasks',async t => {
  const {store} = fixture(t), alice = store.addUser('alice');
  store.write('alice',alice.token,upload(store.read('alice',alice.token)));
  store.disableUser('alice');assert.throws(()=>store.read('alice',alice.token),{status:401});
  const next = store.rotateUser('alice');assert.notEqual(next.token,alice.token);
  assert.throws(()=>store.read('alice',alice.token),{status:401});assert.equal(store.read('alice',next.token).revision,1);
  assert.throws(()=>store.addUser('alice'));
});

test('a token rotated while a PUT body is arriving is rejected before commit',async t => {
  const {store} = fixture(t), alice = store.addUser('alice'), {url} = await listening(t,store);
  const body=JSON.stringify(upload(store.read('alice',alice.token)));
  const pending = new Promise((resolve,reject)=>{
    const req=http.request(url+'/api/v1/users/alice/sync',{method:'PUT',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.write(body.slice(0,20));
    setTimeout(()=>{store.rotateUser('alice');req.end(body.slice(20));},50);
  });
  assert.equal(await pending,401);assert.equal(store.listUsers()[0].revision,0);
});

test('failed authentication is bounded and throttled; health remains available',async t => {
  const {store} = fixture(t);store.addUser('alice');const {url}=await listening(t,store,{authFailureLimit:2});
  assert.equal((await request(url,'alice','bad')).status,401);assert.equal((await request(url,'alice','bad')).status,401);
  assert.equal((await request(url,'alice','bad')).status,429);assert.equal((await fetch(url+'/healthz')).status,200);
});

test('restart persistence, consistent backups and offline restoration including tokens',async t => {
  const folder=mkdtempSync(path.join(tmpdir(),'todo-server-persist-')), dataDir=path.join(folder,'data'), backupDir=path.join(folder,'backups');
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  let store=new Store(dataDir), alice=store.addUser('alice');const originalId=store.serverId;
  store.write('alice',alice.token,upload(store.read('alice',alice.token),data('已备份')));
  const saved=await store.backupTo(backupDir);
  assert.equal(readFileSync(saved).includes(Buffer.from(alice.token)),false);
  store.close();store=new Store(dataDir);assert.equal(store.serverId,originalId);assert.equal(store.read('alice',alice.token).revision,1);
  store.write('alice',alice.token,upload(store.read('alice',alice.token),data('备份后的修改')));store.rotateUser('alice');store.close();
  const restored=await restoreBackup(dataDir,backupDir,saved);assert(restored.beforeRestore);
  store=new Store(dataDir);assert.equal(store.serverId,originalId);assert.equal(store.read('alice',alice.token).data.tasks[0].text,'已备份');store.close();
  const bad=path.join(backupDir,'invalid.sqlite');writeFileSync(bad,'not a database');await assert.rejects(()=>restoreBackup(dataDir,backupDir,bad));
  store=new Store(dataDir);assert.equal(store.read('alice',alice.token).revision,1);store.close();
});

test('administrative commands create independent users and never list raw tokens',t => {
  const folder=mkdtempSync(path.join(tmpdir(),'todo-server-cli-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const cli=(...args)=>spawnSync(process.execPath,[path.resolve('src/cli.mjs'),...args],{encoding:'utf8',env:{...process.env,DATA_DIR:path.join(folder,'data'),BACKUP_DIR:path.join(folder,'backups')}});
  const added=cli('user','add','default');assert.equal(added.status,0);const created=JSON.parse(added.stdout);assert.equal(created.userId,'default');assert(created.token.length>=40);
  const listed=cli('user','list');assert.equal(listed.status,0);assert(!listed.stdout.includes(created.token));assert(!listed.stdout.includes('token_hash'));
  assert.equal(cli('user','add','../bad').status,1);assert.equal(cli('user','add','default').status,1);
  assert.equal(cli('user','disable','default').status,0);assert.equal(cli('user','rotate','default').status,0);
  const saved=cli('backup');assert.equal(saved.status,0);assert(saved.stdout.trim().endsWith('.sqlite'));
});
