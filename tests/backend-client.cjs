// Integration harness: use the desktop's real SyncClient against an isolated server.
const assert=require('node:assert/strict');
const {loadSource}=require(process.cwd()+'/tests/helpers.cjs');
const {SyncClient,syncData,validateRemote}=loadSource('sync');
const server=process.env.TODO_SYNC_TEST_URL,token=process.env.TODO_SYNC_TEST_TOKEN;
if(!server||!token||!['127.0.0.1','localhost'].includes(new URL(server).hostname))throw new Error('Use an isolated loopback test server');
const cfg={server,userId:'verify-alice',enabled:false,allowHttp:true,hasToken:true};
const make=text=>syncData([{id:'parent',text,done:false,collapsed:false,groupId:'daily',repeat:'weekly',reminderAt:'2026-10-20T09:55:00.000Z',reminder:'2026-10-20T17:55',childListStyle:'decimal',children:[{id:'child',text:'子任务',done:false,collapsed:false,children:[]}]}],[{id:'daily',name:'日常',color:'#4b9b72'}],{level1:'top',level2:'bottom',level3:'bottom'});
function device(text){
 const state={local:make(text),checkpoint:null,backups:[]};
 const io={readLocal:()=>structuredClone(state.local),request:async(method,body)=>{
  const response=await fetch(server+'/api/v1/users/'+cfg.userId+'/sync',{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 },saveCheckpoint:async value=>{state.checkpoint=value;},backup:async value=>{state.backups.push(value);},applyRemote:async(data,expected,checkpoint)=>{assert.equal(JSON.stringify(state.local),JSON.stringify(expected));state.backups.push(state.local);state.local=structuredClone(data);state.checkpoint=checkpoint;}};
 return {state,client:new SyncClient(cfg,io,null),io};
}
(async()=>{
 const a=device('设备A'),b=device('设备B');
 assert((await a.client.run()).conflict);await a.client.run('local');assert.equal(a.client.checkpoint.revision,1);
 assert((await b.client.run()).conflict);await b.client.run('remote');assert.equal(b.state.local.tasks[0].text,'设备A');
 a.state.local.tasks[0].text='A上传';await a.client.run();await b.client.run();assert.equal(b.state.local.tasks[0].text,'A上传');
 b.state.local.tasks[0].children[0].done=true;await b.client.run();await a.client.run();assert.equal(a.state.local.tasks[0].children[0].done,true);
 a.state.local.tasks[0].text='A离线编辑';b.state.local.tasks[0].text='B离线编辑';await a.client.run();assert((await b.client.run()).conflict);await b.client.run('remote');assert.equal(b.state.local.tasks[0].text,'A离线编辑');
 const before=a.client.checkpoint.revision;a.state.local.tasks[0].text='A竞争';b.state.local.tasks[0].text='B竞争';
 const result=await Promise.all([a.client.run(),b.client.run()]);assert.equal(result.filter(x=>x.conflict).length,1);
 const conflicted=result[0].conflict?a:b;await conflicted.client.run('remote');
 assert.equal(a.client.checkpoint.revision,b.client.checkpoint.revision);assert.equal(a.client.checkpoint.revision,before+1);
 assert.deepEqual(a.state.local,b.state.local);assert(a.state.backups.length&&b.state.backups.length);
 const crossed=await fetch(server+'/api/v1/users/verify-bob/sync',{headers:{Authorization:'Bearer '+token}});assert.equal(crossed.status,401);
 const response=await a.io.request('GET');const snapshot=validateRemote(response.body,cfg);assert.equal(snapshot.data.tasks[0].repeat,'weekly');assert.equal(snapshot.data.tasks[0].childListStyle,'decimal');
 console.log('PASS: real desktop SyncClient + container server: first direction, two-device upload/download, completion, offline conflict, concurrent upload, user isolation and recurrence metadata');
})().catch(error=>{console.error(error);process.exit(1);});
