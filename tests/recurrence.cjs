const fs=require("fs"),path=require("path"),vm=require("vm"),assert=require("node:assert/strict"),http=require("http");
const root=process.cwd();
const ts=require(path.join(root,"node_modules/typescript"));
const moduleResult={exports:{}};
const placementModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/taskPlacement.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:placementModule.exports,module:placementModule});
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/recurrence.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:moduleResult.exports,module:moduleResult,Date,Set,require:()=>placementModule.exports});
const {expandRecurringTasks:expand,occurrenceAt}=moduleResult.exports;
const at=s=>new Date(s).getTime();
const make=(overrides={})=>({id:"daily-original",text:"下班打卡",done:false,collapsed:false,children:[],groupId:"daily",reminderAt:"2026-10-14T17:55:00+08:00",reminder:"2026-10-14T17:55",repeat:"daily",...overrides});
const original=make({children:[make({id:"child",text:"子任务",done:true,repeat:"",reminderAt:"",children:[]})]});
const input=[original],json=JSON.stringify(input);
let result=expand(input,at("2026-10-15T00:00:00+08:00"));
assert.equal(result.length,2);
assert.equal(JSON.stringify(input),json);
assert.equal(result[0].reminderAt,original.reminderAt);
assert.equal(result[0].done,false);
assert.equal(result[1].reminder,"2026-10-15T17:55");
assert.equal(result[1].groupId,"daily");
assert.equal(result[1].children[0].done,false);
assert.notEqual(result[1].children[0].id,original.children[0].id);
assert.equal(new Set(result.flatMap(t=>[t.id,...t.children.map(c=>c.id)])).size,4);
assert.equal(expand(result,at("2026-10-15T23:59:00+08:00")),result);
result=expand(JSON.parse(JSON.stringify(result)),at("2026-10-18T00:00:00+08:00"));
assert.equal(result.length,5);
assert.equal(new Set(result.map(t=>t.id)).size,5);
assert.equal(result.filter(t=>!t.repeatArchived).length,1);
const doneResult=expand([make({done:true})],at("2026-10-15T08:00:00+08:00"));
assert.equal(doneResult[0].done,true);assert.equal(doneResult[1].done,false);
assert.equal(expand([make()],at("2026-10-14T23:59:00+08:00")).length,1);
assert.equal(expand([make({repeat:"weekly"})],at("2026-10-21T00:00:00+08:00")).length,2);
const jan=new Date("2026-01-31T17:55:00+08:00");
assert.equal(occurrenceAt(jan,"monthly",1).getDate(),28);
assert.equal(occurrenceAt(jan,"monthly",2).getDate(),31);
assert.equal(occurrenceAt(new Date("2024-02-29T09:00:00+08:00"),"yearly",1).getDate(),28);
assert.equal(expand([make({reminderAt:"invalid"})],Date.now()).length,1);
const nested=expand([make({repeat:"",children:[make({id:"nested"})]})],at("2026-10-15T00:00:00+08:00"));
assert.equal(nested[0].children.length,2);
console.log("PASS: recurrence history, completed history, midnight generation, restart catch-up, idempotence, nested IDs, week/month/leap-year boundaries");
(async()=>{
 const {chromium}=require('./helpers.cjs').loadPlaywright();
 const server=http.createServer((req,res)=>{
   const url=new URL(req.url,"http://localhost"),file=path.join(root,"dist",url.pathname==="/"?"index.html":url.pathname);
   if(!file.startsWith(path.join(root,"dist"))||!fs.existsSync(file)){res.writeHead(404);return res.end();}
   const types={".html":"text/html",".js":"text/javascript",".css":"text/css"};
   res.setHeader("Content-Type",types[path.extname(file)]||"application/octet-stream");res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 let browser;
 try {
   browser=await chromium.launch({headless:true,channel:"msedge"});
   const page=await browser.newPage({viewport:{width:420,height:560},timezoneId:"Asia/Hong_Kong"});
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.clock.install({time:new Date("2026-10-15T08:00:00+08:00")});
   await page.addInitScript(({task})=>{
     window.saved=[];window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{
       if(cmd==="load_tasks")return [task];
       if(cmd==="load_preferences")return {tools:[],groups:[{id:"daily",name:"日常",color:"#4b9b72"}]};
       if(cmd==="get_startup")return false;
       if(cmd==="save_tasks"){window.saved.push(structuredClone(args.tasks));return;}
       return null;
     }};
   },{task:original});
   await page.goto("http://127.0.0.1:"+server.address().port);
   await page.waitForFunction(()=>window.saved.some(t=>t.length===2));
   assert.equal(await page.locator(".taskText").filter({visible:true}).count(),4);
   assert.equal(await page.locator(".reminderTime.overdue").count(),1);
   const options=page.getByTitle("选项").first();
   await options.click();await page.getByRole("dialog").waitFor();
   await page.getByRole("heading",{name:"Todo",exact:true}).click();
   await page.getByRole("dialog").waitFor({state:"detached"});
   await options.click();await page.getByRole("dialog").getByLabel("所属分组").selectOption("");
   await page.getByRole("dialog").waitFor({state:"detached"});
   await options.click();
   await page.getByRole("dialog").getByLabel("提醒时间").fill("2026-10-16T18:20");
   await page.getByRole("heading",{name:"Todo",exact:true}).click();
   await page.getByRole("dialog").waitFor({state:"detached"});
   await page.waitForFunction(()=>window.saved.at(-1).some(t=>t.reminder==="2026-10-16T18:20"));
   await options.click();await page.keyboard.press("Escape");await page.getByRole("dialog").waitFor({state:"detached"});
   await page.setViewportSize({width:340,height:300});
   await options.click();
   const rect=await page.getByRole("dialog").boundingBox();
   assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=340&&rect.y+rect.height<=300);
   assert.deepEqual(errors,[]);
   console.log("PASS: browser integration, overdue styling, click outside saves/closes, group selection closes, Escape, small-window panel bounds");
 } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

