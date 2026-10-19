const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),http=require('http');
const ts=require('typescript'),cache={};
function load(name){
 if(name.endsWith('.json'))return {default:JSON.parse(fs.readFileSync(path.join('src',name),'utf8'))};
 if(cache[name])return cache[name];
 const mod={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(path.join('src',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports:mod.exports,module:mod,Date,Set,require:id=>load(id.replace('./',''))});
 return cache[name]=mod.exports;
}
const {DEFAULT_PLACEMENT,normalizePlacement,positionAt,insertTask}=load('taskPlacement');
const {expandRecurringTasks:expand}=load('recurrence');
assert.equal(JSON.stringify(normalizePlacement(null)),JSON.stringify(DEFAULT_PLACEMENT));
assert.equal(JSON.stringify(normalizePlacement({level1:'top',level2:'bad'})),JSON.stringify({level1:'top',level2:'bottom',level3:'bottom'}));
const make=(id,extra={})=>({id,text:id,done:false,collapsed:false,children:[],groupId:'',...extra});
const scheduled=id=>make(id,{repeat:'daily',reminderAt:'2026-10-14T17:55:00+08:00',reminder:'2026-10-14T17:55'});
const now=new Date('2026-10-16T08:00:00+08:00').getTime();
for(let bits=0;bits<8;bits++){
 const p={level1:bits&1?'top':'bottom',level2:bits&2?'top':'bottom',level3:bits&4?'top':'bottom'};
 for(let depth=1;depth<=3;depth++){
   const existing=[make('first'),scheduled('repeat'),make('last')];
   let input=existing;
   for(let i=1;i<depth;i++)input=[make('parent'+i,{children:input})];
   const before=JSON.stringify(input);
   const result=expand(input,now,p);
   assert.equal(JSON.stringify(input),before);
   let list=result;for(let i=1;i<depth;i++)list=list[0].children;
   const ids=list.map(t=>t.id),isTop=positionAt(p,depth)==='top';
   assert.equal(JSON.stringify(ids),JSON.stringify(isTop?['repeat:cycle:2','repeat:cycle:1','first','repeat','last']:['first','repeat','last','repeat:cycle:1','repeat:cycle:2']));
   assert.equal(expand(result,now,p),result);
   const inserted=insertTask(existing,make('new'),positionAt(p,depth));
   assert.equal(inserted[isTop?0:3].id,'new');
 }
}
console.log('PASS: all 8 placement combinations, three recurrence depths, existing order unchanged, restart idempotence, malformed/legacy preferences');
(async()=>{
 const {chromium}=require('./helpers.cjs').loadPlaywright();
 const dist=path.resolve('dist');
 const server=http.createServer((req,res)=>{
  const file=path.join(dist,new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'index.html'));
  if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:420,height:560},timezoneId:'Asia/Hong_Kong'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const prefs={tools:[{name:'测试文档',path:'C:/test.md',icon:'📄'}],groups:[{id:'a',name:'日常',color:'#4b9b72'},{id:'b',name:'今日计划',color:'#4f83bd'},{id:'c',name:'普通待办',color:'#c58a3d'}]};
  const tasks=[make('u1'),make('a1',{groupId:'a'}),make('b1',{groupId:'b'}),make('c1',{groupId:'c'}),make('c2',{groupId:'c'}),...['a','b','c'].map(x=>make(x+'-done',{groupId:x,done:true}))];
  await page.addInitScript(({prefs,tasks})=>{
   window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
    if(cmd==='load_tasks')return JSON.parse(localStorage.getItem('mock.tasks')||JSON.stringify(tasks));
    if(cmd==='load_preferences')return JSON.parse(localStorage.getItem('mock.prefs')||JSON.stringify(prefs));
    if(cmd==='get_startup')return false;
    if(cmd==='save_tasks'){localStorage.setItem('mock.tasks',JSON.stringify(args.tasks));return;}
    if(cmd==='save_preferences'){localStorage.setItem('mock.prefs',JSON.stringify(args.state));return;}
    return null;
   }};
  },{prefs,tasks});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const topInput=page.getByPlaceholder('添加一件要做的事…');await topInput.waitFor();await page.waitForFunction(()=>localStorage.getItem('mock.prefs'));
  const placementLabels=['一级任务新增位置','二级任务新增位置','三级任务新增位置'];
  async function setPlacement(values){
   await page.getByRole('button',{name:'设置',exact:true}).click();
   for(let i=0;i<3;i++)await page.getByLabel(placementLabels[i],{exact:true}).selectOption(values[i]);
   await page.getByRole('button',{name:'设置',exact:true}).click();
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();
  for(const label of placementLabels)assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'bottom');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'分组',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'上移分组：日常',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'下移分组：普通待办',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'上移分组：普通待办',exact:true}).click();
  await page.getByRole('button',{name:'上移分组：普通待办',exact:true}).click();
  assert.deepEqual(await page.locator('.groupEditName').allTextContents(),['普通待办','日常','今日计划']);
  await page.locator('.groupManagerHead button').click();
  const headerOrder=async(selector)=>await page.locator(selector+' .groupHeader button > span').allTextContents();
  assert.deepEqual(await headerOrder('.list > ul'),['普通待办','日常','今日计划']);
  assert.deepEqual(await headerOrder('.completed > ul'),['普通待办','日常','今日计划']);
  await setPlacement(['top','bottom','top']);
  await page.getByTitle('新任务所属分组').selectOption('c');
  async function addRoot(text){await topInput.fill(text);await page.getByRole('button',{name:'添加',exact:true}).click();}
  await addRoot('c-new1');await addRoot('c-new2');
  const rootOrder=async()=>await page.locator('.list > ul > li > .row > .taskText').evaluateAll(xs=>xs.map(x=>x.value));
  assert.deepEqual(await rootOrder(),['u1','c-new2','c-new1','c1','c2','a1','b1']);
  const row=text=>page.locator('.row').filter({has:page.locator('.taskText[value="'+text+'"]')});
  async function addChild(parent,text){await row(parent).getByTitle('添加子任务',{exact:true}).click();await page.locator('.taskText[value="新子任务"]').fill(text);}
  const children=async(parent)=>await row(parent).locator('..').locator(':scope > ul > li > .row > .taskText').evaluateAll(xs=>xs.map(x=>x.value));
  await addChild('c-new2','child1');await addChild('c-new2','child2');
  assert.deepEqual(await children('c-new2'),['child1','child2']);
  await addChild('child1','grand1');await addChild('child1','grand2');
  assert.deepEqual(await children('child1'),['grand2','grand1']);
  await setPlacement(['bottom','top','bottom']);
  await addRoot('c-bottom');await addChild('c-new2','child3');await addChild('child1','grand3');
  assert.deepEqual(await children('c-new2'),['child3','child1','child2']);
  assert.deepEqual(await children('child1'),['grand2','grand1','grand3']);
  assert.deepEqual(await rootOrder(),['u1','c-new2','c-new1','c1','c2','c-bottom','a1','b1']);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mock.tasks')).some(t=>t.text==='c-bottom'));
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('mock.prefs')));
  assert.deepEqual(saved.taskPlacement,{level1:'bottom',level2:'top',level3:'bottom'});
  assert.deepEqual(saved.tools,prefs.tools);assert.deepEqual(saved.groups.map(g=>g.id),['c','a','b']);
  await page.reload();await topInput.waitFor();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  for(let i=0;i<3;i++)assert.equal(await page.getByLabel(placementLabels[i],{exact:true}).inputValue(),['bottom','top','bottom'][i]);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  assert.deepEqual(await headerOrder('.list > ul'),['普通待办','日常','今日计划']);
  await page.setViewportSize({width:340,height:300});
  await page.getByRole('button',{name:'分组',exact:true}).click();
  const bounds=await page.locator('.groupManager').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=340&&bounds.y+bounds.height<=300);
  const arrowBounds=await page.getByRole('button',{name:'下移分组：普通待办',exact:true}).boundingBox();assert(arrowBounds.x+arrowBounds.width<=340);
  await page.locator('.groupManagerHead button').click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByLabel('三级任务新增位置',{exact:true}).selectOption('top');
  assert.equal(await page.getByLabel('三级任务新增位置',{exact:true}).inputValue(),'top');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log('PASS: UI level-specific insertions, group move controls, pending/completed group order, preferences reload and toolbox retention, 340x300 layout');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
