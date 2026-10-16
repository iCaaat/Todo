import {copyFileSync,cpSync,existsSync,mkdirSync,readdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const output=path.join(root,"releases");
const binary=path.join(root,"src-tauri","target","release","app.exe");
if(!existsSync(binary))throw new Error("找不到 app.exe，请先成功构建 Windows release 版本。");
mkdirSync(output,{recursive:true});
copyFileSync(binary,path.join(output,"Todo.exe"));
cpSync(path.join(root,"tools"),path.join(output,"tools"),{recursive:true});
// Refresh the previous filename as a redirect so archived executables open the current tool.
writeFileSync(path.join(output,"tools","项目工作任务.html"),
 '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>项目任务工作台</title><meta http-equiv="refresh" content="0;url=项目任务工作台.html"><a href="项目任务工作台.html">打开项目任务工作台</a></html>',"utf8");
const installers=path.join(root,"src-tauri","target","release","bundle","nsis");
if(existsSync(installers)){
 const destination=path.join(output,"installers");
 mkdirSync(destination,{recursive:true});
 for(const file of readdirSync(installers,{withFileTypes:true})){
  if(file.isFile()&&file.name.toLowerCase().endsWith(".exe"))copyFileSync(path.join(installers,file.name),path.join(destination,file.name));
 }
}
console.log("可运行文件已归档："+path.join(output,"Todo.exe"));
console.log("安装包（如本次有生成）已归档至："+path.join(output,"installers"));
