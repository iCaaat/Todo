const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),http=require('http');
const ts=require('typescript'),modules={};
function load(name){
 if(name.endsWith('.json'))return {default:JSON.parse(fs.readFileSync(path.join('src',name),'utf8'))};
 if(modules[name])return modules[name];const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,Date,Set,require:id=>load(id.replace('./',''))});
 return modules[name]=mod.exports;
}
const {formatListMarker:marker}=load('taskNumbering');
assert.equal(marker('lower-alpha',25),'z.');assert.equal(marker('lower-alpha',26),'aa.');assert.equal(marker('upper-alpha',701),'ZZ.');assert.equal(marker('upper-alpha',702),'AAA.');
const make=(id,extra={})=>({id,text:id,done:false,collapsed:false,children:[],groupId:'',...extra});
const repeating=make('repeat',{childListStyle:'decimal',repeat:'daily',reminderAt:'2026-10-14T17:55:00+08:00',children:[make('child',{childListStyle:'lower-alpha',children:[make('grandchild')]})]});
const expanded=load('recurrence').expandRecurringTasks([repeating],new Date('2026-10-15T08:00:00+08:00').getTime());
assert.equal(expanded[1].childListStyle,'decimal');assert.equal(expanded[1].children[0].childListStyle,'lower-alpha');
console.log('PASS: alphabet overflow boundaries and list styles retained in recurring task copies');
(async()=>{
 const {chromium}=require('./helpers.cjs').loadPlaywright();
 const dist=path.resolve('dist'),server=http.createServer((req,res)=>{
  const file=path.join(dist,new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'index.html'));
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:420,height:560},timezoneId:'Asia/Hong_Kong'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const tasks=[make('项目方案',{children:[make('整理资料',{children:[make('收集需求'),make('归档文件')]}),make('撰写方案')]}),make('其他任务',{children:[make('其他子任务')]})];
  await page.addInitScript(({tasks})=>{
   window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
    if(cmd==='load_tasks')return JSON.parse(localStorage.getItem('test.tasks')||JSON.stringify(tasks));
    if(cmd==='load_preferences')return {tools:[],groups:[],taskPlacement:{level1:'bottom',level2:'top',level3:'bottom'}};
    if(cmd==='get_startup')return false;
    if(cmd==='save_tasks'){localStorage.setItem('test.tasks',JSON.stringify(args.tasks));return;}
    return null;
   }};
  },{tasks});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('.taskText').first().waitFor();
  const row=text=>page.locator('.row').filter({has:page.locator('.taskText[value="'+text+'"]')});
  const directRows=text=>row(text).locator('..').locator(':scope > ul > li > .row');
  const numbers=text=>directRows(text).locator('.taskNumber').allTextContents();
  const texts=text=>directRows(text).locator('.taskText').evaluateAll(xs=>xs.map(x=>x.value));
  async function choose(text,style){
   await row(text).getByTitle('选项',{exact:true}).click();
   await page.getByRole('dialog').getByLabel('启用列表',{exact:true}).selectOption(style);
   await page.getByRole('dialog').waitFor({state:'detached'});
  }
  assert.equal(await page.locator('.taskNumber').count(),0);
  await choose('项目方案','decimal');assert.deepEqual(await numbers('项目方案'),['1.','2.']);
  assert.deepEqual(await numbers('整理资料'),[]);assert.deepEqual(await numbers('其他任务'),[]);
  assert.deepEqual(await texts('项目方案'),['整理资料','撰写方案']);
  await choose('整理资料','lower-alpha');assert.deepEqual(await numbers('整理资料'),['a.','b.']);
  await row('收集需求').getByTitle('选项',{exact:true}).click();assert.equal(await page.getByRole('dialog').getByLabel('启用列表',{exact:true}).count(),0);await page.keyboard.press('Escape');
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/list-numbering.png'});
  await row('项目方案').getByTitle('添加子任务',{exact:true}).click();await page.locator('.taskText[value="新子任务"]').fill('检查方案');
  assert.deepEqual(await texts('项目方案'),['检查方案','整理资料','撰写方案']);assert.deepEqual(await numbers('项目方案'),['1.','2.','3.']);
  const dataTransfer=await page.evaluateHandle(()=>new DataTransfer());
  await row('撰写方案').getByLabel('拖动排序',{exact:true}).dispatchEvent('dragstart',{dataTransfer});
  await row('检查方案').dispatchEvent('drop',{dataTransfer});
  await row('撰写方案').getByLabel('拖动排序',{exact:true}).dispatchEvent('dragend',{dataTransfer});
  assert.deepEqual(await texts('项目方案'),['撰写方案','检查方案','整理资料']);assert.deepEqual(await numbers('项目方案'),['1.','2.','3.']);
  await row('检查方案').getByTitle('删除任务',{exact:true}).click();await page.getByRole('button',{name:'确定删除',exact:true}).click();
  assert.deepEqual(await texts('项目方案'),['撰写方案','整理资料']);assert.deepEqual(await numbers('项目方案'),['1.','2.']);
  await row('撰写方案').getByRole('checkbox').check();assert.deepEqual(await numbers('项目方案'),['1.','2.']);
  await choose('项目方案','parenthesized');assert.deepEqual(await numbers('项目方案'),['(1)','(2)']);
  await choose('项目方案','');assert.deepEqual(await numbers('项目方案'),[]);assert.deepEqual(await numbers('整理资料'),['a.','b.']);
  await row('项目方案').getByTitle('选项',{exact:true}).click();await page.getByRole('dialog').getByLabel('提醒时间',{exact:true}).fill('2026-12-31T18:00');
  await page.getByRole('dialog').getByLabel('启用列表',{exact:true}).selectOption('upper-alpha');await page.getByRole('dialog').waitFor({state:'detached'});
  assert.deepEqual(await numbers('项目方案'),['A.','B.']);
  await page.waitForFunction(()=>{const t=JSON.parse(localStorage.getItem('test.tasks'))[0];return t.childListStyle==='upper-alpha'&&t.reminder==='2026-12-31T18:00'});
  await row('项目方案').getByRole('checkbox').check();assert.equal(await page.locator('.completed .taskNumber').count(),4);
  await row('项目方案').getByRole('checkbox').uncheck();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test.tasks'))[0].done===false);
  await page.reload();await row('项目方案').waitFor();assert.deepEqual(await numbers('项目方案'),['A.','B.']);assert.deepEqual(await numbers('整理资料'),['a.','b.']);
  await page.setViewportSize({width:340,height:300});
  await row('项目方案').getByTitle('选项',{exact:true}).click();
  const box=await page.getByRole('dialog').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=340&&box.y+box.height<=300);
  await page.getByRole('dialog').getByLabel('启用列表',{exact:true}).selectOption('decimal');await page.getByRole('dialog').waitFor({state:'detached'});
  const taskRows=await directRows('项目方案').evaluateAll(xs=>xs.map(x=>{const cb=x.querySelector('input[type="checkbox"]').getBoundingClientRect(),n=x.querySelector('.taskNumber').getBoundingClientRect(),text=x.querySelector('.taskText').getBoundingClientRect();return {cb:cb.right,nl:n.left,nr:n.right,tl:text.left,nw:n.width,tw:text.width,right:x.getBoundingClientRect().right}}));
  for(const r of taskRows){assert(r.nl>=r.cb&&r.tl>=r.nr&&r.nw>0&&r.tw>0&&r.right<=340);}
  assert.deepEqual(errors,[]);
  console.log('PASS: per-parent styles, third-level exclusion, top insertion, drag reorder, deletion, completion, disabling, reminder draft retention, reload and 340x300 layout');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
