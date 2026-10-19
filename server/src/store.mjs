import {DatabaseSync, backup} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {mkdirSync,chmodSync,copyFileSync,renameSync,rmSync,existsSync} from 'node:fs';
import path from 'node:path';
import {HttpError,MAX_BYTES,validUserId,validateData,validateUpload} from './validation.mjs';

const digest = token => createHash('sha256').update(token).digest();
export class Store {
  constructor(dataDir, {historyLimit = 50} = {}) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 1000) throw new Error('HISTORY_LIMIT must be 1..1000');
    this.dataDir = path.resolve(dataDir); this.historyLimit = historyLimit;
    mkdirSync(this.dataDir,{recursive:true,mode:0o700});
    this.filename = path.join(this.dataDir,'sync.sqlite');
    this.db = new DatabaseSync(this.filename,{timeout:5000});
    chmodSync(this.filename,0o600);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw new Error('Database schema is newer than this server'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT, data TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        user_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id,revision)
      );
      PRAGMA user_version=1;
    `);
    this.db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('serverId',randomUUID());
    this.serverId = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('serverId').value;
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  checkUserId(id) { if (!validUserId(id)) throw new Error('User ID must be 1..64 ASCII letters, digits, dot, underscore or hyphen'); }
  addUser(id) {
    this.checkUserId(id);
    return this.transaction(() => {
      if (this.db.prepare('SELECT id FROM users WHERE id=?').get(id)) throw new Error('User already exists; use user rotate to reset its token');
      const token = randomBytes(32).toString('base64url');
      this.db.prepare('INSERT INTO users(id,token_hash,created_at) VALUES (?,?,?)').run(id,digest(token).toString('hex'),new Date().toISOString());
      return {userId:id,token};
    });
  }
  rotateUser(id) {
    this.checkUserId(id);
    return this.transaction(() => {
      const token = randomBytes(32).toString('base64url');
      const result = this.db.prepare('UPDATE users SET token_hash=?,enabled=1 WHERE id=?').run(digest(token).toString('hex'),id);
      if (!result.changes) throw new Error('User does not exist');
      return {userId:id,token};
    });
  }
  disableUser(id) {
    this.checkUserId(id);
    if (!this.db.prepare('UPDATE users SET enabled=0 WHERE id=?').run(id).changes) throw new Error('User does not exist');
  }
  listUsers() { return this.db.prepare('SELECT id AS userId,enabled,revision,updated_at AS updatedAt FROM users ORDER BY id').all(); }
  authenticate(id,token) {
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
    const expected = user ? Buffer.from(user.token_hash,'hex') : Buffer.alloc(32);
    const actual = digest(token);
    const matches = expected.length === actual.length && timingSafeEqual(expected,actual);
    if (!user || !user.enabled || !matches) throw new HttpError(401,'Authentication failed');
    return user;
  }
  envelope(user) {
    return {schemaVersion:1,serverId:this.serverId,userId:user.id,revision:user.revision,updatedAt:user.updated_at,data:user.data === null ? null : JSON.parse(user.data)};
  }
  read(id,token) { return this.envelope(this.authenticate(id,token)); }
  write(id,token,body) {
    validateUpload(body);
    return this.transaction(() => {
      // Recheck auth after reading the request body, inside the write transaction.
      const current = this.authenticate(id,token);
      if (body.serverId !== this.serverId || body.baseRevision !== current.revision) throw new HttpError(409,'Revision or server identity changed');
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new HttpError(409,'Revision limit reached');
      const updatedAt = new Date().toISOString(), revision = current.revision + 1;
      const next = {schemaVersion:1,serverId:this.serverId,userId:id,revision,updatedAt,data:body.data};
      if (Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES) throw new HttpError(413,'Response snapshot is too large');
      if (current.data !== null) this.db.prepare('INSERT INTO history(user_id,revision,updated_at,data) VALUES (?,?,?,?)').run(id,current.revision,current.updated_at,current.data);
      this.db.prepare('UPDATE users SET revision=?,updated_at=?,data=? WHERE id=?').run(revision,updatedAt,JSON.stringify(body.data),id);
      this.db.prepare('DELETE FROM history WHERE user_id=? AND revision NOT IN (SELECT revision FROM history WHERE user_id=? ORDER BY revision DESC LIMIT ?)').run(id,id,this.historyLimit);
      return next;
    });
  }
  history(id) {
    this.checkUserId(id);
    return this.db.prepare('SELECT revision,updated_at AS updatedAt FROM history WHERE user_id=? ORDER BY revision DESC').all(id);
  }
  exportHistory(id,revision) {
    this.checkUserId(id);
    const row = this.db.prepare('SELECT revision,updated_at,data FROM history WHERE user_id=? AND revision=?').get(id,revision);
    if (!row) throw new Error('History revision does not exist');
    return {schemaVersion:1,serverId:this.serverId,userId:id,revision:row.revision,updatedAt:row.updated_at,data:JSON.parse(row.data)};
  }
  async backupTo(folder) {
    mkdirSync(folder,{recursive:true,mode:0o700});
    const filename = path.join(folder,`todo-sync-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.sqlite`);
    await backup(this.db,filename); chmodSync(filename,0o600); return filename;
  }
}

// Administrative offline restore only. Stop the service before invoking this.
export async function restoreBackup(dataDir,backupDir,source) {
  const resolved = path.resolve(source), folder = path.resolve(backupDir);
  if (path.dirname(resolved) !== folder || !path.basename(resolved).endsWith('.sqlite')) throw new Error('Restore source must be a .sqlite file directly inside BACKUP_DIR');
  const sourceDb = new DatabaseSync(resolved,{readOnly:true});
  try {
    if (sourceDb.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || sourceDb.prepare('PRAGMA user_version').get().user_version !== 1) throw new Error('Invalid backup database');
    if (!sourceDb.prepare('SELECT value FROM metadata WHERE key=?').get('serverId')?.value) throw new Error('Backup has no server ID');
    for (const user of sourceDb.prepare('SELECT * FROM users').all()) {
      if (!validUserId(user.id) || !/^[0-9a-f]{64}$/.test(user.token_hash) || !Number.isSafeInteger(user.revision) || user.revision < 0 || (user.data === null && user.revision !== 0)) throw new Error('Invalid backup user');
      if (user.data !== null) validateData(JSON.parse(user.data));
    }
  } finally { sourceDb.close(); }
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const filename = path.join(dataDir,'sync.sqlite'), temporary = path.join(dataDir,`restore-${randomUUID()}.sqlite`);
  let beforeRestore = null;
  if (existsSync(filename)) {
    const current = new Store(dataDir);
    try { beforeRestore = await current.backupTo(backupDir); current.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    finally { current.close(); }
  }
  try {
    copyFileSync(resolved,temporary); chmodSync(temporary,0o600);
    rmSync(filename+'-wal',{force:true}); rmSync(filename+'-shm',{force:true});
    renameSync(temporary,filename);
  } finally { rmSync(temporary,{force:true}); }
  return {restored:resolved,beforeRestore};
}
