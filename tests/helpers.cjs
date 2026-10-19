// Playwright is optional for development; no browser tooling is shipped in the app.
exports.loadPlaywright=function(){
 const name=process.env.TODO_PLAYWRIGHT_MODULE||"playwright";
 try{return require(name)}catch(error){
  throw new Error("无法加载 Playwright。请在项目根目录运行 npm install --no-save --package-lock=false playwright 后重试，或通过 TODO_PLAYWRIGHT_MODULE 指定已有模块路径。",{cause:error});
 }
};

exports.loadSource=function(name,globals={},cache={}){
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
 if(name.endsWith('.json'))return {default:JSON.parse(fs.readFileSync(path.join('src',name),'utf8'))};
 if(cache[name])return cache[name];
 const mod={exports:{}};cache[name]=mod.exports;
 const js=ts.transpileModule(fs.readFileSync(path.join('src',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports:mod.exports,module:mod,Date,Set,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,atob,...globals,require:id=>exports.loadSource(id.replace('./',''),globals,cache)});
 return mod.exports;
};
