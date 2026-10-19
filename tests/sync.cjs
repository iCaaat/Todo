const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {loadSource,loadPlaywright}=require('./helpers.cjs');
const {DEFAULT_SYNC_CONFIG,SyncClient,syncData,fingerprint,validateData,validateRemote,profileKey}=loadSource('sync');
const copy=v=>JSON.parse(JSON.stringify(v));
const cfg={server:'https://sync.example.test',userId:'alice',enabled:false,allowHttp:false,hasToken:true};
const make=(name='任务')=>syncData([{id:'task',text:name,done:false,collapsed:false,groupId:'daily',reminderAt:'2026-10-19T17:55:00+08:00',remindedAt:'local-only',children:[]}],[{id:'daily',name:'日常',color:'#4b9b72'}],{level1:'top',level2:'bottom',level3:'bottom'});
const envelope=(data,revision=1)=>({schemaVersion:1,serverId:'server-A',userId:'alice',revision,updatedAt:revision?'2026-10-19T08:00:00Z':null,data:copy(data)});
function fixture(initial=make(),remote=envelope(null,0),checkpoint=null){
 const state={local:copy(initial),remote:copy(remote),puts:0,backups:0,applied:0,cp:checkpoint,beforePut:null,afterPut:null,failBackup:false,status:200};
 const io={readLocal:()=>copy(state.local),request:async(method,body)=>{
  if(state.status!==200)return {status:state.status,body:null};
  if(method==='GET')return {status:200,body:copy(state.remote)};
  if(state.beforePut)state.beforePut();
  if(body.baseRevision!==state.remote.revision||body.serverId!==state.remote.serverId)return {status:409,body:null};
  state.puts++;state.remote={...state.remote,revision:state.remote.revision+1,updatedAt:'2026-10-19T08:01:00Z',data:copy(body.data)};
  if(state.afterPut)state.afterPut();return {status:200,body:copy(state.remote)};
 },saveCheckpoint:async cp=>{state.cp=copy(cp);},backup:async()=>{if(state.failBackup)throw new Error('backup failed');state.backups++;},applyRemote:async(data,expected,cp)=>{assert.equal(fingerprint(state.local),fingerprint(expected));state.backups++;state.applied++;state.local=copy(data);state.cp=copy(cp);}};
 return {state,io,client:new SyncClient(cfg,io,checkpoint)};
}
(async()=>{
 const {removeTaskGroup}=loadSource('taskGroups');
 const grouped=make();
 grouped.tasks[0].children=[{...copy(grouped.tasks[0]),id:'child',children:[{...copy(grouped.tasks[0]),id:'leaf',children:[]}]}];
 const before=copy(grouped.tasks),deleted=removeTaskGroup(grouped.tasks,'daily');
 const expected=copy(before);expected[0].groupId='';expected[0].children[0].groupId='';expected[0].children[0].children[0].groupId='';
 assert.equal(JSON.stringify(deleted),JSON.stringify(expected));assert.equal(JSON.stringify(grouped.tasks),JSON.stringify(before));
 assert.equal(removeTaskGroup(deleted,'missing'),deleted);
 const invalidLocal=fixture();invalidLocal.state.local.tasks[0].groupId='deleted-group';
 await assert.rejects(()=>invalidLocal.client.run(),/本机任务引用了不存在的分组/);assert.equal(invalidLocal.state.puts,0);
 const invalidRemote=fixture();invalidRemote.state.remote=envelope(make());invalidRemote.state.remote.data.tasks[0].groupId='deleted-group';
 await assert.rejects(()=>invalidRemote.client.run(),/云端任务引用了不存在的分组/);assert.equal(invalidRemote.state.applied,0);
 console.log('PASS: recursive group deletion preserves tasks/reminders and local/remote validation names the correct source');
 assert.equal(DEFAULT_SYNC_CONFIG.allowHttp,false);assert.equal(DEFAULT_SYNC_CONFIG.syncIntervalMinutes,15);assert.equal(DEFAULT_SYNC_CONFIG.syncOnEdit,true);
 const first=fixture();assert((await first.client.run()).conflict);assert.equal(first.state.puts,0);
 await first.client.run('local');assert.equal(first.state.puts,1);assert.equal(first.client.checkpoint.revision,1);assert.equal(first.client.dirty,false);
 assert.equal(first.state.remote.data.tasks[0].remindedAt,undefined);assert.equal(first.state.remote.data.tasks[0].repeatPending,undefined);
 await first.client.run();assert.equal(first.state.puts,1);
 const cp=copy(first.client.checkpoint);
 first.state.local.tasks[0].text='本机新修改';await first.client.run();assert.equal(first.state.puts,2);
 first.state.remote=envelope(make('云端新修改'),3);await first.client.run();assert.equal(first.state.applied,1);assert.equal(first.state.local.tasks[0].text,'云端新修改');
 first.state.local.tasks[0].text='离线编辑';first.state.remote=envelope(make('另一台电脑编辑'),4);assert((await first.client.run()).conflict);const puts=first.state.puts;
 first.state.remote=envelope(make('又有新版本'),5);assert((await first.client.run('local')).conflict);assert.equal(first.state.puts,puts);
 await first.client.run('remote');assert.equal(first.state.local.tasks[0].text,'又有新版本');
 const race=fixture(make('本机修改'),envelope(make(),1),cp);race.state.beforePut=()=>{race.state.remote=envelope(make('竞争修改'),2);};assert((await race.client.run()).conflict);assert.equal(race.state.puts,0);
 const editing=fixture(make('修改一'),envelope(make(),1),cp);editing.state.afterPut=()=>{editing.state.local.tasks[0].text='上传期间继续编辑';};await editing.client.run();assert.equal(editing.client.dirty,true);assert.equal(editing.client.checkpoint.data.tasks[0].text,'修改一');editing.state.afterPut=null;await editing.client.run();assert.equal(editing.state.remote.data.tasks[0].text,'上传期间继续编辑');
 const backup=fixture();await backup.client.run();backup.state.failBackup=true;await assert.rejects(()=>backup.client.run('local'),/backup failed/);assert.equal(backup.state.puts,0);
 const wrongIdentity=fixture(make(),{...envelope(make(),2),userId:'bob'},cp);await assert.rejects(()=>wrongIdentity.client.run(),/用户身份不匹配/);assert.equal(wrongIdentity.state.applied,0);
 const reset=fixture(make(),{...envelope(make(),9),serverId:'server-new'},cp);assert((await reset.client.run()).conflict);
 const moved=fixture();const other=new SyncClient({...cfg,userId:'bob'},moved.io,cp);assert.equal(other.checkpoint,null);
 const bad=fixture(make(),envelope(make(),1),cp);bad.state.remote.data.tasks[0].children=[copy(bad.state.remote.data.tasks[0])];await assert.rejects(()=>bad.client.run(),/任务格式/);assert.equal(bad.state.applied,0);
 const offline=fixture();offline.state.status=401;await assert.rejects(()=>offline.client.test(),/认证失败/);assert.equal(offline.state.puts,0);
 const redirect=fixture();redirect.state.status=302;await assert.rejects(()=>redirect.client.test(),/最终服务器地址/);assert.equal(redirect.state.puts,0);
 const tested=fixture();await tested.client.test();assert.equal(tested.state.cp,null);assert.equal(tested.state.puts,0);assert.equal(tested.state.applied,0);
 assert.throws(()=>validateData({...make(),taskPlacement:{level1:'bad'}}),/新增位置/);
 assert.throws(()=>validateRemote({...envelope(make()),schemaVersion:2},cfg),/协议/);
 console.log('PASS: first-use direction, snapshot filtering, upload/download, offline divergence, version race, editing during PUT, backup failure, identity/server reset, account detachment, invalid data and read-only connection test');

 const {chromium}=loadPlaywright(),dist=path.resolve('dist');
 const server=http.createServer((req,res)=>{const file=path.join(dist,new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'index.html'));if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:420,height:560},timezoneId:'Asia/Hong_Kong'});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date('2026-10-19T08:00:00+08:00')});
  await page.addInitScript(({initial})=>{
   window.syncCalls=[];window.syncBackups=[];window.syncRemote=JSON.parse(localStorage.getItem('mock.remote')||'null')||{schemaVersion:1,serverId:'mock-server',userId:'alice',revision:0,updatedAt:null,data:null};
   window.syncConfig=JSON.parse(localStorage.getItem('mock.config')||'null')||{server:'',userId:'default',enabled:false,hasToken:false};window.checkpoint=JSON.parse(localStorage.getItem('mock.checkpoint')||'null');
   const initialPrefs={tools:[{name:'仅此电脑的文档',path:'C:/local/test.md'}],groups:initial.groups,taskPlacement:initial.taskPlacement};
   window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
    const readTasks=()=>JSON.parse(localStorage.getItem('mock.tasks')||JSON.stringify(initial.tasks));
    const readPrefs=()=>JSON.parse(localStorage.getItem('mock.prefs')||JSON.stringify(initialPrefs));
    if(cmd==='load_tasks')return readTasks();if(cmd==='load_preferences')return readPrefs();if(cmd==='get_startup')return false;
    if(cmd==='save_tasks'){localStorage.setItem('mock.tasks',JSON.stringify(args.tasks));return;}if(cmd==='save_preferences'){localStorage.setItem('mock.prefs',JSON.stringify(args.state));return;}
    if(cmd==='sync_load_config')return {...window.syncConfig};if(cmd==='sync_load_checkpoint')return window.checkpoint;
    if(cmd==='sync_save_config'){
     if(/^http:\/\//i.test(args.config.server)&&!args.config.allowHttp)throw new Error('使用远程 HTTP 地址前，请勾选“允许 HTTP 连接”');
     const changed=JSON.stringify([window.syncConfig.server,window.syncConfig.userId])!==JSON.stringify([args.config.server,args.config.userId]);if(changed)window.checkpoint=null;
     window.syncConfig={...args.config,hasToken:!!args.token||(!changed&&window.syncConfig.hasToken&&!args.clearToken)};localStorage.setItem('mock.config',JSON.stringify(window.syncConfig));localStorage.setItem('mock.checkpoint',JSON.stringify(window.checkpoint));return {...window.syncConfig};
    }
    if(cmd==='sync_save_checkpoint'){window.checkpoint=structuredClone(args.checkpoint);localStorage.setItem('mock.checkpoint',JSON.stringify(window.checkpoint));return;}
    if(cmd==='sync_backup'){window.syncBackups.push(structuredClone(args.remote));return;}
    if(cmd==='sync_http'){
     window.syncCalls.push(structuredClone(args));if(window.syncNetworkError)throw new Error('模拟断网');
     if(args.method==='GET')return {status:200,body:structuredClone(window.syncRemote)};
     if(args.body.baseRevision!==window.syncRemote.revision)return {status:409,body:null};
     window.syncRemote={...window.syncRemote,revision:window.syncRemote.revision+1,updatedAt:new Date().toISOString(),data:structuredClone(args.body.data)};localStorage.setItem('mock.remote',JSON.stringify(window.syncRemote));return {status:200,body:structuredClone(window.syncRemote)};
    }
    if(cmd==='sync_apply'){
     window.syncBackups.push({local:readTasks(),remote:structuredClone(args.data)});
     const tasks=args.data.tasks.map(t=>({...t,remindedAt:readTasks().find(x=>x.id===t.id&&x.reminderAt===t.reminderAt)?.remindedAt||''}));
     localStorage.setItem('mock.tasks',JSON.stringify(tasks));localStorage.setItem('mock.prefs',JSON.stringify({...readPrefs(),groups:args.data.groups,taskPlacement:args.data.taskPlacement}));window.checkpoint=structuredClone(args.checkpoint);localStorage.setItem('mock.checkpoint',JSON.stringify(window.checkpoint));localStorage.setItem('mock.remote',JSON.stringify(window.syncRemote));return tasks;
    }
    return null;
   }};
  },{initial:make()});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>localStorage.getItem('mock.tasks'));
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const panel=page.locator('.syncSettings');await panel.scrollIntoViewIfNeeded();
  const footer=page.locator('footer .syncFooter'),frequency=panel.getByLabel('定时同步频率',{exact:true}),editSync=panel.getByLabel('编辑后自动同步（约 3 秒）',{exact:true});
  assert.equal(await footer.textContent(),'本地自动保存');assert.equal(await frequency.inputValue(),'15');assert.equal(await editSync.isChecked(),true);
  for(const removed of ['用户设置与任务数据保存在同一目录','提醒到点会先显示应用内右下角提示','预留多用户入口','支持 IP 与端口，例如'])assert(!(await page.locator('.settings').innerText()).includes(removed));

  assert.equal(await panel.getByRole('button',{name:'立即同步',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.syncCalls.length),0);
  await page.getByLabel('同步服务器地址',{exact:true}).fill(cfg.server);await page.getByLabel('同步用户 ID',{exact:true}).fill('alice');await page.getByLabel('同步访问令牌',{exact:true}).fill('test-secret-only-in-credential-bridge');
  await panel.getByRole('button',{name:'保存同步设置'}).click();
  assert.equal(await page.getByLabel('同步访问令牌',{exact:true}).inputValue(),'');
  await panel.getByRole('button',{name:'测试连接',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.syncStatus').textContent.includes('连接成功'));
  assert.equal(await page.evaluate(()=>window.syncCalls.filter(x=>x.method==='PUT').length),0);
  await panel.getByRole('button',{name:'立即同步',exact:true}).click();let dialog=page.getByRole('dialog',{name:'同步方向选择'});await dialog.waitFor();
  assert.equal(await dialog.getByRole('button',{name:'使用云端版本'}).isDisabled(),true);
  await dialog.getByRole('button',{name:'使用本机版本'}).click();await dialog.waitFor({state:'detached'});
  await page.waitForFunction(()=>window.syncRemote.revision===1);
  const remote=await page.evaluate(()=>window.syncRemote);assert.equal(remote.data.tasks[0].remindedAt,undefined);assert.equal(remote.data.tools,undefined);
  const state=await page.evaluate(()=>({calls:window.syncCalls,prefs:JSON.parse(localStorage.getItem('mock.prefs'))}));assert(!JSON.stringify(state).includes('test-secret-only-in-credential-bridge'));
  // Enable automatic sync, then verify the 3-second edit debounce.
  await panel.getByLabel('启用自动同步').check();await panel.getByRole('button',{name:'保存同步设置'}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.taskText').fill('自动上传后的任务');await page.clock.runFor(3500);
  await page.waitForFunction(()=>window.syncRemote.data.tasks[0].text==='自动上传后的任务');
  // A remote-only edit is pulled and local-only tools remain intact.
  await page.evaluate(()=>{window.syncRemote.revision++;window.syncRemote.data.tasks[0].text='另一台设备修改';});const beforeIdle=await page.evaluate(()=>window.syncCalls.length);
  await page.clock.runFor(60000);assert.equal(await page.locator('.taskText').inputValue(),'自动上传后的任务');assert.equal(await page.evaluate(()=>window.syncCalls.length),beforeIdle);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await page.evaluate(()=>window.syncCalls.length),beforeIdle,'Focus before deadline must not sync');
  await page.clock.runFor(14*60000);
  await page.waitForFunction(()=>document.querySelector('.taskText').value==='另一台设备修改');
  const afterPull=await page.evaluate(()=>window.syncCalls.length);await page.clock.runFor(100);assert.equal(await page.evaluate(()=>window.syncCalls.length),afterPull,'Download must not trigger another startup sync');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mock.prefs')).tools[0].path),'C:/local/test.md');
  // Both sides changed: no blind overwrite; conflict dialog stays within a small viewport.
  await page.locator('.taskText').fill('本机冲突修改');await page.evaluate(()=>{window.syncRemote.revision++;window.syncRemote.data.tasks[0].text='云端冲突修改';});await page.clock.runFor(3500);await dialog.waitFor();
  await page.setViewportSize({width:340,height:300});const rect=await dialog.boundingBox();assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=340&&rect.y+rect.height<=300);
  await page.screenshot({path:'test-results/sync-conflict.png'});await dialog.getByRole('button',{name:'使用云端版本'}).click();await dialog.waitFor({state:'detached'});
  assert.equal(await page.locator('.taskText').inputValue(),'云端冲突修改');
  await page.getByRole('button',{name:'设置',exact:true}).click();await panel.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/sync-settings.png'});
  // Edit opt-out keeps periodic sync active; all preset values remain available.
  assert.equal(await footer.textContent(),'云端已同步');assert((await footer.getAttribute('title')).includes('上次同步：'));
  assert.deepEqual(await frequency.locator('option').evaluateAll(items=>items.map(x=>x.value)),['1','15','30','60','custom']);
  await frequency.selectOption('1');await editSync.uncheck();await panel.getByRole('button',{name:'保存同步设置'}).click();
  await page.waitForFunction(()=>window.syncConfig.syncIntervalMinutes===1&&!window.syncConfig.syncOnEdit);
  await page.clock.runFor(100);await page.waitForFunction(()=>document.querySelector('.syncStatus').textContent==='已同步');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('.taskText').fill('关闭编辑触发后仍保留定时同步');const periodicBefore=await page.evaluate(()=>window.syncCalls.length);
  await page.clock.runFor(3500);assert.equal(await page.evaluate(()=>window.syncCalls.length),periodicBefore);assert.equal(await footer.textContent(),'等待云同步');
  await page.clock.runFor(57000);await page.waitForFunction(()=>window.syncRemote.data.tasks[0].text==='关闭编辑触发后仍保留定时同步');
  // Successful manual sync also restarts the interval; the old deadline is cancelled.
  await page.clock.runFor(30000);await page.getByRole('button',{name:'设置',exact:true}).click();
  await panel.getByRole('button',{name:'立即同步',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.syncStatus').textContent==='已同步');
  const afterManual=await page.evaluate(()=>window.syncCalls.length);await page.clock.runFor(31000);assert.equal(await page.evaluate(()=>window.syncCalls.length),afterManual);
  await page.clock.runFor(30000);await page.waitForFunction(count=>window.syncCalls.length>count,afterManual);
  // Network failures expose a compact footer and retry at most once per minute.
  await page.evaluate(()=>window.syncNetworkError=true);await panel.getByRole('button',{name:'立即同步',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('footer .syncFooter').textContent==='云同步失败');assert((await footer.getAttribute('title')).includes('模拟断网'));
  const afterFailure=await page.evaluate(()=>window.syncCalls.length);await page.clock.runFor(59000);assert.equal(await page.evaluate(()=>window.syncCalls.length),afterFailure);
  await page.evaluate(()=>window.syncNetworkError=false);await page.clock.runFor(1500);await page.waitForFunction(()=>document.querySelector('footer .syncFooter').textContent==='云端已同步');
  // Invalid custom values cannot be saved. Valid custom frequency is persisted.
  await frequency.selectOption('custom');const custom=panel.getByLabel('自定义同步间隔（分钟）',{exact:true});
  for(const value of ['', '0','1.5','1441']){await custom.fill(value);assert.equal(await panel.getByRole('button',{name:'保存同步设置'}).isDisabled(),true);}
  await custom.fill('7');await panel.getByRole('button',{name:'保存同步设置'}).click();await page.clock.runFor(100);
  await page.waitForFunction(()=>window.syncConfig.syncIntervalMinutes===7);assert.equal(await frequency.inputValue(),'custom');
  console.log('PASS: default 15-minute polling, edit opt-out, idle/manual deadline reset, no focus/download loops, error footer/backoff and custom input validation');
  // Saving a new user detaches the old checkpoint and never uploads the previous user's data silently.
  await panel.getByLabel('启用自动同步').uncheck();await page.getByLabel('同步用户 ID',{exact:true}).fill('bob');await page.getByLabel('同步访问令牌',{exact:true}).fill('bob-secret');
  await panel.getByRole('button',{name:'保存同步设置'}).click();await page.evaluate(()=>{window.syncRemote={...window.syncRemote,userId:'bob',revision:0,data:null,updatedAt:null};});
  const before=await page.evaluate(()=>window.syncCalls.filter(x=>x.method==='PUT').length);await panel.getByRole('button',{name:'立即同步',exact:true}).click();await dialog.waitFor();assert.equal(await page.evaluate(()=>window.syncCalls.filter(x=>x.method==='PUT').length),before);
  await dialog.getByRole('button',{name:'稍后处理'}).click();
  // Remote HTTP is explicit, persisted, and upgrading the URL detaches the old baseline.
  const allowHttp=panel.getByLabel('允许 HTTP 连接',{exact:true});assert.equal(await allowHttp.isChecked(),false);
  await page.getByLabel('同步服务器地址',{exact:true}).fill('http://203.0.113.10:18080');
  await panel.getByRole('button',{name:'保存同步设置'}).click();
  await page.waitForFunction(()=>document.querySelector('.syncStatus').textContent.includes('请勾选'));
  assert.notEqual(await page.evaluate(()=>window.syncConfig.server),'http://203.0.113.10:18080');
  await allowHttp.check();assert.equal(await panel.getByRole('button',{name:'测试连接',exact:true}).isDisabled(),true);
  await page.getByLabel('同步访问令牌',{exact:true}).fill('http-mock-token');await panel.getByRole('button',{name:'保存同步设置'}).click();
  await page.waitForFunction(()=>window.syncConfig.allowHttp===true);assert.equal(await page.evaluate(()=>window.checkpoint),null);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await allowHttp.isChecked(),true);
  await panel.getByRole('button',{name:'测试连接',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.syncStatus').textContent.includes('连接成功'));
  const requestsBeforeUpgrade=await page.evaluate(()=>window.syncCalls.length);
  await page.getByLabel('同步服务器地址',{exact:true}).fill('https://sync.example.test');await allowHttp.uncheck();await page.getByLabel('同步访问令牌',{exact:true}).fill('https-mock-token');
  await panel.getByRole('button',{name:'保存同步设置'}).click();await page.waitForFunction(()=>window.syncConfig.server==='https://sync.example.test'&&!window.syncConfig.allowHttp);
  assert.equal(await page.evaluate(()=>window.syncCalls.length),requestsBeforeUpgrade);
  await panel.getByRole('button',{name:'立即同步',exact:true}).click();await dialog.waitFor();await dialog.getByRole('button',{name:'稍后处理'}).click();
  await page.setViewportSize({width:340,height:300});await allowHttp.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/sync-http-settings.png'});
  await page.setViewportSize({width:420,height:560});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByTitle('添加子任务',{exact:true}).click();
  await page.locator('.row').nth(1).getByTitle('添加子任务',{exact:true}).click();
  await page.getByRole('button',{name:'分组',exact:true}).click();
  await page.locator('.groupEditRow').getByRole('button',{name:'删除',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mock.prefs')).groups.length===0);
  const preserved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mock.tasks')));
  assert.equal(preserved.length,1);assert.equal(preserved[0].children.length,1);assert.equal(preserved[0].children[0].children.length,1);assert.equal(preserved[0].groupId,'');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await panel.getByRole('button',{name:'立即同步',exact:true}).click();await dialog.waitFor();await dialog.getByRole('button',{name:'使用本机版本'}).click();await dialog.waitFor({state:'detached'});
  await page.waitForFunction(()=>window.syncRemote.data?.groups.length===0);
  assert.equal(await page.evaluate(()=>window.syncRemote.data.tasks[0].children[0].children.length),1);
  console.log('PASS: deleting a group through the UI keeps all three task levels and uploads the result');
  // Persisted custom interval survives reload; startup sends exactly one GET.
  await panel.getByLabel('启用自动同步').check();await panel.getByRole('button',{name:'保存同步设置'}).click();await page.clock.runFor(100);
  await page.waitForFunction(()=>document.querySelector('.syncStatus').textContent==='已同步');
  await page.reload();await page.clock.runFor(100);await page.waitForFunction(()=>window.syncCalls.length===1);
  await page.waitForFunction(()=>document.querySelector('footer .syncFooter').textContent==='云端已同步');
  await page.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await frequency.inputValue(),'custom');assert.equal(await editSync.isChecked(),false);assert.equal(await panel.getByLabel('自定义同步间隔（分钟）',{exact:true}).inputValue(),'7');
  await page.clock.runFor(6*60000);assert.equal(await page.evaluate(()=>window.syncCalls.length),1);
  await page.clock.runFor(61000);await page.waitForFunction(()=>window.syncCalls.length===2);
  await panel.getByLabel('启用自动同步').uncheck();await panel.getByRole('button',{name:'保存同步设置'}).click();
  await page.waitForFunction(()=>document.querySelector('footer .syncFooter').textContent==='自动同步已关闭');
  const stopped=await page.evaluate(()=>window.syncCalls.length);await page.clock.runFor(8*60000);assert.equal(await page.evaluate(()=>window.syncCalls.length),stopped);
  await page.setViewportSize({width:340,height:300});await page.screenshot({path:'test-results/sync-frequency-small.png'});
  const box=await footer.boundingBox();assert(box.x>=0&&box.x+box.width<=340);
  console.log('PASS: custom interval/edit toggle persist through restart, one startup sync, 7-minute schedule and master switch stopping all automatic requests');
  assert.deepEqual(errors,[]);
  console.log('PASS: HTTP default-off, explicit opt-in/save/persistence, blocked unsaved requests, HTTPS upgrade and fresh direction choice');
  console.log('PASS: client settings, token masking/exclusion, manual first-use choice, automatic debounce/poll download, local-tool preservation, conflict resolution, small-window bounds and user-switch safety');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
