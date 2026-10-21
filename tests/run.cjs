const path=require("node:path"),{spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"..");
for(const name of ["placement","recurrence","numbering","completion","holidays","sync"]){
 console.log("\n--- "+name+" ---");
 const result=spawnSync(process.execPath,[path.join(__dirname,name+".cjs")],{
  cwd:root,stdio:"inherit",env:{...process.env,TZ:"Asia/Hong_Kong"}
 });
 if(result.error){console.error(result.error);process.exit(1)}
 if(result.status!==0)process.exit(result.status||1);
}
