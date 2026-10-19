import path from 'node:path';
export function config(env = process.env) {
  function integer(name,fallback,max) {
    const value = env[name] || String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new Error(`Invalid ${name}`);
    return Number(value);
  }
  return {dataDir:path.resolve(env.DATA_DIR || './data'),backupDir:path.resolve(env.BACKUP_DIR || './backups'),port:integer('PORT',3000,65535),host:env.HOST || '0.0.0.0',historyLimit:integer('HISTORY_LIMIT',50,1000)};
}
