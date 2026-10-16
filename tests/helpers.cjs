// Playwright is optional for development; no browser tooling is shipped in the app.
exports.loadPlaywright=function(){
 const name=process.env.TODO_PLAYWRIGHT_MODULE||"playwright";
 try{return require(name)}catch(error){
  throw new Error("无法加载 Playwright。请在项目根目录运行 npm install --no-save --package-lock=false playwright 后重试，或通过 TODO_PLAYWRIGHT_MODULE 指定已有模块路径。",{cause:error});
 }
};
