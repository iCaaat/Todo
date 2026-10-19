import {Store} from './store.mjs';
import {createApp} from './app.mjs';
import {config} from './config.mjs';
process.umask(0o077);
const settings = config();
const store = new Store(settings.dataDir,settings);
const server = createApp(store);
server.on('error',error => { console.error('Server could not listen:',error.code || 'internal'); store.close(); process.exitCode = 1; });
server.listen(settings.port,settings.host,() => console.log(`Todo sync server listening on ${settings.host}:${settings.port}`));
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  const timer = setTimeout(() => server.closeAllConnections(),5000); timer.unref();
  server.close(() => { clearTimeout(timer); store.close(); });
}
process.on('SIGTERM',stop); process.on('SIGINT',stop);
