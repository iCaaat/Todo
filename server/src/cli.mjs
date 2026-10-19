import {Store,restoreBackup} from './store.mjs';
import {config} from './config.mjs';
process.umask(0o077);
const settings = config(), [command,action,id,argument] = process.argv.slice(2);
let store;
try {
  if (command === 'restore') {
    if (!action || id !== '--confirm' || argument) throw new Error('Stop the service, then use: restore /backups/FILE.sqlite --confirm');
    console.log(JSON.stringify(await restoreBackup(settings.dataDir,settings.backupDir,action)));
  } else {
    store = new Store(settings.dataDir,settings);
    if (command === 'user' && action === 'add' && id && !argument) console.log(JSON.stringify(store.addUser(id)));
    else if (command === 'user' && action === 'rotate' && id && !argument) console.log(JSON.stringify(store.rotateUser(id)));
    else if (command === 'user' && action === 'disable' && id && !argument) { store.disableUser(id); console.log('User disabled'); }
    else if (command === 'user' && action === 'list' && !id) console.log(JSON.stringify(store.listUsers(),null,2));
    else if (command === 'history' && action && !id) console.log(JSON.stringify(store.history(action),null,2));
    else if (command === 'history' && action && /^\d+$/.test(id || '') && !argument) console.log(JSON.stringify(store.exportHistory(action,Number(id)),null,2));
    else if (command === 'backup' && !action) console.log(await store.backupTo(settings.backupDir));
    else throw new Error('Usage: user add|rotate|disable ID; user list; history ID [REVISION]; backup; restore FILE --confirm');
  }
} catch (error) {
  // Generated tokens are printed only on successful add/rotate, never in errors.
  console.error('Command failed:',error.message); process.exitCode = 1;
} finally { store?.close(); }
