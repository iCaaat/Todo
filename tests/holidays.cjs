const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {loadSource,loadPlaywright}=require('./helpers.cjs');
const holiday=loadSource('holidays'),{expandRecurringTasks:expand,alignHolidayTask}=loadSource('recurrence');
const {BUILTIN_HOLIDAYS:cache,dayInfo,mergeHolidayCache,parseHolidayYear}=holiday;
const date=s=>new Date(s+'T17:55:00+08:00'),now=s=>new Date(s+'T23:59:00+08:00').getTime();
const task=(day,repeat,extra={})=>({id:'series',text:'打卡',done:false,collapsed:false,children:[],reminderAt:date(day).toISOString(),reminder:day+'T17:55',repeat,groupId:'daily',...extra});
assert.equal(dayInfo(date('2026-01-04'),cache).makeup,true);
assert.equal(dayInfo(date('2026-10-10'),cache).work,true);
assert.equal(dayInfo(date('2026-10-11'),cache).work,false);
assert.equal(dayInfo(date('2026-10-01'),cache).holiday,true);
assert.equal(dayInfo(date('2027-01-05'),cache).known,false);
const input=[task('2026-10-09','workday',{children:[task('2026-10-09','',{id:'child',done:true})]})],before=JSON.stringify(input);
const result=expand(input,now('2026-10-12'));
assert.equal(JSON.stringify(input),before);
assert.deepEqual(Array.from(result,t=>t.reminder.slice(0,10)),['2026-10-09','2026-10-10','2026-10-12']);
assert.equal(result[2].children[0].done,false);
assert.equal(result[2].children[0].reminder,'2026-10-12T17:55');
assert.equal(expand(result,now('2026-10-12')),result);
assert.equal(new Set(result.map(t=>t.id)).size,3);
const holidays=expand([task('2026-09-25','holiday')],now('2026-10-02'));
assert.equal(holidays.at(-1).reminder,'2026-10-02T17:55');
assert(holidays.every(t=>dayInfo(new Date(t.reminderAt),cache).holiday));
assert.equal(alignHolidayTask(task('2026-10-01','workday'),cache).reminder,'2026-10-08T17:55');
assert.equal(alignHolidayTask(task('2026-10-09','holiday'),cache).repeatPending,true);
assert.equal(alignHolidayTask(task('2027-01-04','workday'),cache).repeatPending,true);
const cross=[task('2026-12-31','workday')];assert.equal(expand(cross,now('2027-01-05')),cross);
const future={year:2027,papers:['https://www.gov.cn/example'],days:[{name:'元旦',date:'2027-01-01',isOffDay:true}]};
const resumed=expand([alignHolidayTask(task('2027-01-01','workday'),cache)],now('2027-01-04'),undefined,{...cache,2027:future});
assert.equal(resumed[0].reminder,'2027-01-04T17:55');assert.equal(resumed[0].repeatPending,false);
const override={year:2027,papers:['test'],days:[{name:'跨年',date:'2026-12-31',isOffDay:true}]};
assert.equal(dayInfo(date('2026-12-31'),{...cache,2027:override}).holiday,true);
assert.equal(mergeHolidayCache({2026:{year:2026,papers:[],days:[]}})[2026],cache[2026]);
assert.throws(()=>parseHolidayYear({year:2026,papers:['test'],days:[{date:'2026-02-30',name:'bad',isOffDay:true}]},2026));
console.log('PASS: workday/makeup/holiday rules, first-date alignment, history/IDs/child date shifts, unknown-year pause/resume, cross-year overrides and invalid cache rejection');

(async()=>{
 let calls=0;
 const remote={...JSON.parse(fs.readFileSync('src/data/holidays-2026.json','utf8'))};
 const network=loadSource('holidays',{fetch:async url=>{calls++;if(!url.includes('api.github.com'))throw new Error('unreachable');return {ok:true,status:200,text:async()=>JSON.stringify({encoding:'base64',content:Buffer.from(JSON.stringify(remote)).toString('base64')})};}});
 assert.equal((await network.fetchHolidayYear(2026)).year,2026);assert.equal(calls,3);
 const pending=loadSource('holidays',{fetch:async()=>({ok:true,status:200,text:async()=>JSON.stringify({year:2027,papers:[],days:[]})})});assert.equal(await pending.fetchHolidayYear(2027),null);
 const timeout=loadSource('holidays',{setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout:()=>{},fetch:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'}))))});
 await assert.rejects(()=>timeout.fetchHolidayYear(2026),/连接超时/);
 console.log('PASS: network fallback, GitHub base64 Unicode decoding, unpublished-year handling and request timeout');
 const {chromium}=loadPlaywright(),dist=path.resolve('dist');
 const server=http.createServer((req,res)=>{
  const file=path.join(dist,new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'index.html'));
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:420,height:560},timezoneId:'Asia/Hong_Kong'}),errors=[];
  page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-16T08:00:00+08:00')});
  const tasks=[task('2026-10-16','',{id:'root',text:'一级',reminderAt:'',reminder:'',children:[task('2026-10-16','',{id:'child',text:'二级',children:[task('2026-10-16','',{id:'leaf',text:'三级'})]})]})];
  await page.addInitScript(({tasks})=>{
   window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
    if(cmd==='load_tasks')return JSON.parse(localStorage.getItem('test.tasks')||JSON.stringify(tasks));
    if(cmd==='load_preferences')return {tools:[{name:'文档',path:'C:/test.md'}],groups:[{id:'daily',name:'日常',color:'#4b9b72'}],taskPlacement:{level1:'top',level2:'top',level3:'top'}};
    if(cmd==='get_startup')return false;
    if(cmd==='load_holidays')return JSON.parse(localStorage.getItem('test.holidays')||'null');
    if(cmd==='save_holidays'){if(window.failSave)throw new Error('simulated disk failure');localStorage.setItem('test.holidays',JSON.stringify(args.data));return;}
    if(cmd==='save_tasks'){localStorage.setItem('test.tasks',JSON.stringify(args.tasks));return;}
    return null;
   }};
  },{tasks});
  const origin='http://127.0.0.1:'+server.address().port;await page.goto(origin);
  console.log('Browser: loaded Todo');
  const rootRow=page.locator('.row').filter({has:page.locator('input.taskText[data-task-id="root"]')}).first();
  await page.waitForFunction(()=>localStorage.getItem('test.tasks'));
  const top=page.getByPlaceholder('添加一件要做的事…');await top.fill('顶部快速添加');await top.press('Tab');
  assert.equal(await top.inputValue(),'');assert.equal(await top.evaluate(el=>el===document.activeElement),true);
  const count=await page.locator('.taskText').count();await top.press('Tab');assert.equal(await page.locator('.taskText').count(),count);
  // All depths create a sibling immediately after the edited item, even with top insertion preferences.
  for(const [id,text] of [['root','新一级'],['child','新二级'],['leaf','新三级']]){
   await page.locator(`[data-task-id="${id}"]`).press('Tab');
   const focused=page.locator('.taskText:focus');assert.equal(await focused.inputValue(),'');await focused.fill(text);
   const siblings=await page.locator(`[data-task-id="${id}"]`).evaluate(el=>Array.from(el.closest('li').parentElement.children).filter(li=>!li.classList.contains('groupHeader')).map(li=>li.querySelector('.taskText')?.value));
   assert.equal(siblings[siblings.indexOf({root:'一级',child:'二级',leaf:'三级'}[id])+1],text);
  }
  const after=await page.locator('.taskText').count();await page.locator('[data-task-id="leaf"]').press('Shift+Tab');assert.equal(await page.locator('.taskText').count(),after);
  console.log('Browser: Tab at all depths');
  await page.locator('[data-task-id="leaf"]').dispatchEvent('keydown',{key:'Tab',isComposing:true});assert.equal(await page.locator('.taskText').count(),after);
  await page.locator('[data-task-id="leaf"]').press('Tab');await page.locator('.taskText:focus').press('Tab');assert.equal(await page.locator('.taskText').count(),after+1);
  await page.getByRole('button',{name:'工具箱',exact:true}).click();assert.equal(await page.getByTitle('删除快捷入口').count(),0);
  await page.getByTitle('编辑工具箱').click();assert.equal(await page.getByTitle('删除快捷入口').count(),1);
  await page.getByTitle('选择图标').click();await page.getByTitle('编辑工具箱').click();assert.equal(await page.locator('.iconPicker').count(),0);assert.equal(await page.getByTitle('删除快捷入口').count(),0);
  await page.getByRole('button',{name:/工作\/交易日历/}).click();
  console.log('Browser: calendar opened');
  assert.equal(await page.getByRole('button',{name:'A股交易日历（待实现）'}).isDisabled(),true);
  assert.match(await page.locator('[data-date="2026-10-10"]').innerText(),/班.*\n调休补班/);
  assert.match(await page.locator('[data-date="2026-10-02"]').innerText(),/国庆节/);
  await page.route('https://**/*',route=>{
   const match=route.request().url().match(/\/(\d{4})\.json/);if(!match)return route.abort();const year=Number(match[1]);
   const data=year===2027?{year:2027,papers:[],days:[]}:JSON.parse(fs.readFileSync(`src/data/holidays-${year}.json`,'utf8'));
   if(year===2026)data.days.push({name:'测试补班',date:'2026-10-17',isOffDay:false});
   return route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
  });
  await page.getByRole('button',{name:'手动更新',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('test.holidays'));
  console.log('Browser: cache saved');
  await page.getByRole('button',{name:'手动更新',exact:true}).waitFor();
  assert.match(await page.getByRole('status').innerText(),/2027 年安排尚未公布/);
  assert.match(await page.locator('[data-date="2026-10-17"]').innerText(),/调休补班/);
  // Closing during a pending network request must leave the Todo controls usable.
  await page.unroute('https://**/*');let release;
  const gate=new Promise(resolve=>release=resolve);await page.route('https://**/*',async route=>{await gate;await route.abort();});
  await page.getByRole('button',{name:'手动更新',exact:true}).click();await page.locator('.calendarPanelHead button').click();await top.fill('网络请求中仍可添加');await top.press('Tab');
  assert.equal(await page.locator('.taskText').evaluateAll(els=>els.filter(e=>e.value==='网络请求中仍可添加').length),1);
  release();await page.clock.runFor(20000);
  console.log('Browser: closed during pending update');
  await page.getByRole('button',{name:'工具箱',exact:true}).click();await page.getByRole('button',{name:/工作\/交易日历/}).click();
  await page.waitForFunction(()=>!document.querySelector('.calendarToolbar button:last-child').disabled);
  assert.match(await page.getByRole('status').innerText(),/更新失败.*保留原缓存/);
  assert.match(await page.locator('[data-date="2026-10-17"]').innerText(),/调休补班/);
  await page.reload();await page.getByRole('button',{name:'工具箱',exact:true}).click();await page.getByRole('button',{name:/工作\/交易日历/}).click();
  assert.match(await page.locator('[data-date="2026-10-17"]').innerText(),/调休补班/);
  const persisted=await page.evaluate(()=>localStorage.getItem('test.holidays'));
  await page.evaluate(()=>window.failSave=true);await page.unroute('https://**/*');
  await page.route('https://**/*',route=>{
   const year=Number(route.request().url().match(/\/(\d{4})\.json/)[1]);
   const data=year===2027?{year,papers:[],days:[]}:JSON.parse(fs.readFileSync(`src/data/holidays-${year}.json`,'utf8'));
   return route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
  });
  await page.getByRole('button',{name:'手动更新',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role="status"]').textContent.includes('更新未保存'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('test.holidays')),persisted);
  assert.match(await page.locator('[data-date="2026-10-17"]').innerText(),/调休补班/);
  await page.evaluate(()=>window.failSave=false);
  await page.setViewportSize({width:340,height:300});
  const rect=await page.locator('.calendarPanel').boundingBox();assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=340&&rect.y+rect.height<=300);
  assert.equal(await page.locator('.workCalendar').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:'test-results/holidays-calendar.png'});
  await page.locator('.calendarPanelHead button').click();await rootRow.getByTitle('选项',{exact:true}).click();
  await page.getByRole('dialog').getByLabel('提醒时间').fill('2026-10-17T17:55');await page.getByRole('dialog').getByLabel('重复',{exact:true}).selectOption('workday');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.tasks')).some(t=>t.id==='root'&&t.repeat==='workday'&&t.reminder==='2026-10-17T17:55'));
  await rootRow.getByTitle('选项',{exact:true}).click();
  await page.getByRole('dialog').getByLabel('提醒时间').fill('2027-01-04T17:55');await page.getByRole('dialog').getByLabel('重复',{exact:true}).selectOption('holiday');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.tasks')).some(t=>t.id==='root'&&t.repeat==='holiday'&&t.repeatPending));
  assert.match(await page.locator('.holidayScheduleNotice').innerText(),/暂停/);
  assert.deepEqual(errors,[]);
  console.log('PASS: Tab at three depths/group/focus/empty/IME/Shift+Tab, toolbox edit-only delete, calendar update/shared persisted cache, unpublished-year notice, failure fallback, close during fetch, small-window bounds and initial workday alignment');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
