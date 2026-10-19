// Optional integration test. Run from the repository: node tests/backend-compose.cjs
// Creates an isolated project; never starts or stops the user's deployed project.
const {spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {mkdtempSync,rmSync}=require('node:fs');
const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),project='todo-sync-verify-'+randomUUID().slice(0,8);
const env={...process.env,TODO_SYNC_BIND:'127.0.0.1',TODO_SYNC_PORT:'0'};
const base=['compose','-p',project,'-f',path.join(root,'server','compose.yaml')];
const temporary=mkdtempSync(path.join(os.tmpdir(),'todo-sync-test-'));
function run(command,args,{show=false,extra={},timeout=180000}={}){
 const result=spawnSync(command,args,{cwd:root,env:{...env,...extra},encoding:'utf8',timeout,maxBuffer:8*1024*1024});
 if(show||result.status!==0){if(result.stdout)console.log(result.stdout);if(result.stderr)console.log(result.stderr);}
 if(result.error||result.status!==0)throw new Error('Verification command failed',{cause:result.error});
 return result.stdout.trim();
}
const compose=(args,options)=>run('docker',[...base,...args],options);
const endpoint=()=>{const result=compose(['port','sync','3000']).split(/\r?\n/)[0];assert(result.startsWith('127.0.0.1:'));return 'http://'+result;};
async function snapshot(url,token){const response=await fetch(url+'/api/v1/users/verify-alice/sync',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return response.json();}
(async()=>{
 try{
  compose(['config','--quiet']);compose(['up','-d','--build','--wait','--wait-timeout','90'],{show:true});
  let url=endpoint();const credentials=JSON.parse(compose(['exec','-T','sync','node','src/cli.mjs','user','add','verify-alice']));
  compose(['exec','-T','sync','node','src/cli.mjs','user','add','verify-bob']);
  run(process.execPath,[path.join(root,'tests','backend-client.cjs')],{show:true,extra:{TODO_SYNC_TEST_URL:url,TODO_SYNC_TEST_TOKEN:credentials.token}});
  const before=await snapshot(url,credentials.token);
  const saved=compose(['exec','-T','sync','node','src/cli.mjs','backup']).split(/\r?\n/).at(-1);
  compose(['restart','sync']);url=endpoint();let after;
  for(let attempt=0;attempt<30;attempt++){try{after=await snapshot(url,credentials.token);break;}catch{await new Promise(r=>setTimeout(r,500));}}
  assert.deepEqual(after,before,'Restart changed persisted data or server identity');
  // Exercise copying a backup out/in and the documented ownership fix.
  compose(['stop','sync']);const exported=path.join(temporary,'export.sqlite');
  compose(['cp','sync:'+saved,exported]);compose(['cp',exported,'sync:/backups/imported.sqlite']);
  compose(['run','--rm','--no-deps','--user','0:0','--cap-add','CHOWN','sync','chown','1000:1000','/backups/imported.sqlite']);
  compose(['run','--rm','--no-deps','sync','node','src/cli.mjs','restore','/backups/imported.sqlite','--confirm']);
  compose(['up','-d','--wait','--wait-timeout','60']);url=endpoint();
  assert.deepEqual(await snapshot(url,credentials.token),before);
  console.log('PASS: production Compose build, non-root/read-only filesystem, health check, CLI, backup export/import, offline restore and restart persistence');
 }finally{
  compose(['down','--volumes'],{show:true});
  if(path.dirname(temporary)===path.resolve(os.tmpdir())&&path.basename(temporary).startsWith('todo-sync-test-'))rmSync(temporary,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
