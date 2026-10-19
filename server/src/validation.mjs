export const MAX_BYTES = 4_000_000;
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = message => { throw new HttpError(400, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 64000) => typeof value === 'string' && value.length <= max;
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key));
export const validUserId = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value);
const fields = ['id','text','done','collapsed','groupId','children','reminder','reminderAt','repeat','childListStyle','repeatSeries','repeatAnchor','repeatIndex','repeatArchived'];

// Validate without rewriting: ordering, optional fields and recurrence metadata
// must survive a round trip exactly as the desktop client sent them.
export function validateData(data) {
  if (!object(data) || !only(data, ['tasks','groups','taskPlacement']) || !Array.isArray(data.tasks) || !Array.isArray(data.groups) || !object(data.taskPlacement)) fail('Invalid snapshot');
  if (data.groups.length > 1000) fail('Too many groups');
  const groups = new Set(), ids = new Set(); let count = 0;
  for (const group of data.groups) {
    if (!object(group) || !only(group,['id','name','color','collapsed']) || !text(group.id,512) || !group.id || groups.has(group.id) || !text(group.name) || !text(group.color,7) || !/^#[0-9a-f]{6}$/i.test(group.color) || (group.collapsed !== undefined && typeof group.collapsed !== 'boolean')) fail('Invalid group');
    groups.add(group.id);
  }
  function visit(tasks, depth) {
    for (const task of tasks) {
      if (++count > 10000 || depth > 3 || !object(task) || !only(task,fields) || !text(task.id,1024) || !task.id || ids.has(task.id) || !text(task.text) || typeof task.done !== 'boolean' || typeof task.collapsed !== 'boolean' || !Array.isArray(task.children)) fail('Invalid task, depth or duplicate ID');
      ids.add(task.id);
      if (task.groupId !== undefined && (!text(task.groupId,512) || (task.groupId !== '' && !groups.has(task.groupId)))) fail('Unknown group');
      for (const key of ['reminder','reminderAt','repeatAnchor','repeatSeries']) if (task[key] !== undefined && !text(task[key],1024)) fail('Invalid reminder');
      for (const key of ['reminderAt','repeatAnchor']) if (task[key] && !Number.isFinite(Date.parse(task[key]))) fail('Invalid reminder date');
      if (task.repeat !== undefined && !['','daily','weekly','monthly','yearly','workday','holiday'].includes(task.repeat)) fail('Invalid recurrence');
      if (task.childListStyle !== undefined && !['','decimal','parenthesized','lower-alpha','upper-alpha'].includes(task.childListStyle)) fail('Invalid list style');
      if (task.repeatIndex !== undefined && (!Number.isSafeInteger(task.repeatIndex) || task.repeatIndex < 0)) fail('Invalid recurrence index');
      if (task.repeatArchived !== undefined && typeof task.repeatArchived !== 'boolean') fail('Invalid recurrence flag');
      visit(task.children,depth + 1);
    }
  }
  visit(data.tasks,1);
  if (!only(data.taskPlacement,['level1','level2','level3']) || !['level1','level2','level3'].every(key => ['top','bottom'].includes(data.taskPlacement[key]))) fail('Invalid task placement');
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_BYTES) throw new HttpError(413,'Snapshot is too large');
  return data;
}
export function validateUpload(body) {
  if (!object(body) || !only(body,['schemaVersion','serverId','baseRevision','data']) || body.schemaVersion !== 1 || !text(body.serverId,256) || !body.serverId || !Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0) fail('Invalid upload envelope');
  validateData(body.data);
}
