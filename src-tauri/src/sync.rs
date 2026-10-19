use std::{ffi::c_void, path::Path, ptr::{null,null_mut}, time::{Duration,Instant}};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use tauri::Manager;
use windows_sys::Win32::{Networking::WinHttp::*,Security::Credentials::*};
use super::{DATA_LOCK,read_json,write_json};

#[derive(Clone,Deserialize,Serialize)]
#[serde(rename_all="camelCase",default)]
pub struct Config {server:String,user_id:String,enabled:bool,allow_http:bool,sync_interval_minutes:u32,sync_on_edit:bool}
impl Default for Config{fn default()->Self{Self{server:String::new(),user_id:String::new(),enabled:false,allow_http:false,sync_interval_minutes:15,sync_on_edit:true}}}
impl Config {
 fn checked(mut self)->Result<Self,String>{
  if !(1..=1440).contains(&self.sync_interval_minutes){return Err("同步间隔须为 1–1440 分钟的整数".into())}
  self.server=self.server.trim().trim_end_matches('/').into();self.user_id=self.user_id.trim().into();
  if self.user_id.is_empty(){self.user_id="default".into()}
  if self.user_id.len()>64 || !self.user_id.bytes().all(|c|c.is_ascii_alphanumeric()||b"._-".contains(&c)){return Err("用户 ID 仅支持 1–64 位字母、数字、点、下划线和短横线".into())}
  if self.server.is_empty(){if self.enabled{return Err("启用同步前请填写服务器地址和令牌".into())}return Ok(self)}
  if self.server.len()>512{return Err("服务器地址过长".into())}
  let url=tauri::Url::parse(&self.server).map_err(|_|"服务器地址无效")?;
  let local=matches!(url.host_str(),Some("localhost"|"127.0.0.1"|"[::1]"));
  if !matches!(url.scheme(),"http"|"https"){return Err("同步服务器地址仅支持 HTTP 或 HTTPS".into())}
  if url.scheme()=="http" && !local && !self.allow_http{return Err("使用远程 HTTP 地址前，请勾选“允许 HTTP 连接”；也可改用 HTTPS 地址".into())}
  if url.host_str().is_none()||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some(){return Err("服务器地址不能包含用户名、密码、查询参数或片段".into())}
  self.server=url.as_str().trim_end_matches('/').into();Ok(self)
 }
 fn profile(&self)->String{json!([self.server,self.user_id]).to_string()}
 fn target(&self)->Vec<u16>{wide(&format!("TodoSync:{}",self.profile()))}
 fn endpoint(&self)->Result<tauri::Url,String>{tauri::Url::parse(&format!("{}/api/v1/users/{}/sync",self.server,self.user_id)).map_err(|_|"同步接口地址无效".into())}
}
fn wide(value:&str)->Vec<u16>{value.encode_utf16().chain(Some(0)).collect()}
fn load_config(dir:&Path)->Result<Config,String>{
 let path=dir.join("sync-config.json");
 if !path.exists(){return Config{user_id:"default".into(),..Default::default()}.checked()}
 serde_json::from_value::<Config>(read_json(&path)?).map_err(|_|"同步配置格式无效".into()).and_then(Config::checked)
}
fn token(config:&Config)->Result<Option<String>,String>{
 if config.server.is_empty(){return Ok(None)}
 unsafe{
  let mut credential=null_mut();
  if CredReadW(config.target().as_ptr(),CRED_TYPE_GENERIC,0,&mut credential)==0{
   return if windows_sys::Win32::Foundation::GetLastError()==1168{Ok(None)}else{Err("无法读取 Windows 保存的同步令牌".into())};
  }
  let c=&*credential;
  let result=if c.CredentialBlobSize==0||c.CredentialBlobSize>2048{Err("Windows 保存的同步令牌无效".into())}
   else{String::from_utf8(std::slice::from_raw_parts(c.CredentialBlob,c.CredentialBlobSize as usize).to_vec()).map(Some).map_err(|_|"同步令牌编码无效".into())};
  CredFree(credential.cast());result
 }
}
fn save_token(config:&Config,value:&str)->Result<(),String>{
 if value.is_empty()||value.len()>2048||!value.bytes().all(|c|(33..=126).contains(&c)){return Err("令牌须为不含空格的 ASCII 字符，最长 2048 字节".into())}
 if config.server.is_empty(){return Err("请先填写服务器地址".into())}
 unsafe{
  let mut target=config.target();let mut user=wide(&config.user_id);let mut blob=value.as_bytes().to_vec();
  let credential=CREDENTIALW{Flags:0,Type:CRED_TYPE_GENERIC,TargetName:target.as_mut_ptr(),Comment:null_mut(),LastWritten:std::mem::zeroed(),CredentialBlobSize:blob.len() as u32,CredentialBlob:blob.as_mut_ptr(),Persist:CRED_PERSIST_LOCAL_MACHINE,AttributeCount:0,Attributes:null_mut(),TargetAlias:null_mut(),UserName:user.as_mut_ptr()};
  let ok=CredWriteW(&credential,0);blob.fill(0);
  if ok==0{Err("无法把令牌保存到 Windows 凭据管理器".into())}else{Ok(())}
 }
}
fn view(config:&Config)->Result<Value,String>{Ok(json!({"server":config.server,"userId":config.user_id,"enabled":config.enabled,"allowHttp":config.allow_http,"hasToken":token(config)?.is_some(),"syncIntervalMinutes":config.sync_interval_minutes,"syncOnEdit":config.sync_on_edit}))}
fn ensure_profile(dir:&Path,profile:&str)->Result<(),String>{if load_config(dir)?.profile()!=profile{Err("同步账户已变化，已取消旧账户操作".into())}else{Ok(())}}

// Called with DATA_LOCK held. A journal completes both local files and checkpoint
// after a crash, so they can never remain on different sync generations at startup.
pub(super) fn recover(dir:&Path)->Result<(),String>{
 let path=dir.join("sync-apply.pending.json");if !path.exists(){return Ok(())}
 let journal=read_json(&path)?;
 if !journal["tasks"].is_array()||!journal["preferences"].is_object()||!journal["checkpoint"].is_object(){return Err("同步恢复文件无效，请保留备份后检查".into())}
 write_json(&dir.join("tasks.json"),&journal["tasks"])?;
 write_json(&dir.join("preferences.json"),&journal["preferences"])?;
 write_json(&dir.join("sync-state.json"),&journal["checkpoint"])?;
 std::fs::remove_file(path).map_err(|_|"同步恢复文件无法清理".to_string())
}
fn project_task(t:&Value)->Value{
 let mut result=json!({"id":t["id"],"text":t["text"],"done":t["done"],"collapsed":t["collapsed"].as_bool().unwrap_or(false),"groupId":t["groupId"].as_str().unwrap_or(""),"children":t["children"].as_array().map(|xs|xs.iter().map(project_task).collect::<Vec<_>>()).unwrap_or_default()});
 for key in ["reminder","reminderAt","repeat","childListStyle","repeatSeries","repeatAnchor","repeatIndex","repeatArchived"]{if let Some(value)=t.get(key){result[key]=value.clone();}}
 result
}
fn project(tasks:&Value,prefs:&Value)->Value{
 let placement=|key:&str|if prefs["taskPlacement"][key]=="top"{"top"}else{"bottom"};
 json!({"tasks":tasks.as_array().map(|xs|xs.iter().map(project_task).collect::<Vec<_>>()).unwrap_or_default(),
 "groups":prefs["groups"].as_array().map(|xs|xs.iter().map(|g|json!({"id":g["id"],"name":g["name"],"color":g["color"],"collapsed":g["collapsed"].as_bool().unwrap_or(false)})).collect::<Vec<_>>()).unwrap_or_default(),
 "taskPlacement":{"level1":placement("level1"),"level2":placement("level2"),"level3":placement("level3")}})
}
fn check_data(data:&Value)->Result<(),String>{
 if !data["tasks"].is_array()||!data["groups"].is_array()||!data["taskPlacement"].is_object()||data.to_string().len()>4_000_000{return Err("同步数据结构或大小无效".into())}
 fn visit(items:&Value,depth:usize,count:&mut usize,ids:&mut std::collections::HashSet<String>)->Result<(),String>{
  for t in items.as_array().ok_or("同步子任务格式无效")?{
   *count+=1;
   if depth>3||*count>10000||!t["id"].is_string()||!t["text"].is_string()||!t["done"].is_boolean()||!ids.insert(t["id"].as_str().unwrap().to_owned()){return Err("同步任务格式、数量或层级无效".into())}
   visit(&t["children"],depth+1,count,ids)?;
  }Ok(())
 }visit(&data["tasks"],1,&mut 0,&mut std::collections::HashSet::new())
}
fn check_checkpoint(cp:&Value,config:&Config)->Result<(),String>{
 if cp["profile"]!=config.profile()||cp["userId"]!=config.user_id||!cp["serverId"].is_string()||!cp["revision"].is_u64()||!cp["lastSyncAt"].is_string(){return Err("同步检查点身份或格式无效".into())}check_data(&cp["data"])
}
fn backup(dir:&Path,remote:&Value)->Result<(),String>{
 let folder=dir.join("sync-backups");std::fs::create_dir_all(&folder).map_err(|_|"无法创建同步备份目录")?;
 let name=format!("backup-{}.json",chrono::Utc::now().format("%Y%m%dT%H%M%S%.9f"));
 let data=json!({"createdAt":chrono::Utc::now().to_rfc3339(),"local":{"tasks":read_json(&dir.join("tasks.json"))?,"preferences":if dir.join("preferences.json").exists(){read_json(&dir.join("preferences.json"))?}else{Value::Null}},"remote":remote});
 write_json(&folder.join(name),&data)?;
 let mut files=std::fs::read_dir(&folder).map_err(|_|"无法读取同步备份目录")?.filter_map(Result::ok).filter(|f|f.file_type().map(|t|t.is_file()).unwrap_or(false)&&f.file_name().to_string_lossy().starts_with("backup-")&&f.path().extension().is_some_and(|x|x=="json")).map(|f|f.path()).collect::<Vec<_>>();files.sort();
 let remove=files.len().saturating_sub(50);for path in files.into_iter().take(remove){let _=std::fs::remove_file(path);}Ok(())
}
#[tauri::command]
pub fn sync_load_config(app:tauri::AppHandle)->Result<Value,String>{let _lock=DATA_LOCK.lock().map_err(|_|"数据锁不可用")?;let dir=app.path().app_data_dir().map_err(|_|"数据目录不可用")?;view(&load_config(&dir)?)}
#[tauri::command]
pub fn sync_save_config(app:tauri::AppHandle,config:Config,token:Option<String>,clear_token:bool)->Result<Value,String>{
 let config=config.checked()?;let _lock=DATA_LOCK.lock().map_err(|_|"数据锁不可用")?;let dir=app.path().app_data_dir().map_err(|_|"数据目录不可用")?;
 if config.enabled&&clear_token&&token.is_none(){return Err("请先关闭自动同步，再清除令牌".into())}
 std::fs::create_dir_all(&dir).map_err(|_|"无法创建同步配置目录")?;
 if clear_token{unsafe{if CredDeleteW(config.target().as_ptr(),CRED_TYPE_GENERIC,0)==0&&windows_sys::Win32::Foundation::GetLastError()!=1168{return Err("无法清除保存的令牌".into())}}}
 if let Some(mut secret)=token{let result=save_token(&config,&secret);unsafe{secret.as_bytes_mut().fill(0)};result?;}
 let result=view(&config)?;if config.enabled&&result["hasToken"]!=true{return Err("启用自动同步前请保存访问令牌".into())}
 let old=load_config(&dir)?;
 // Changing account always detaches the local dataset, even when returning to a
 // previously used user. A fresh direction choice is mandatory before any PUT.
 if old.profile()!=config.profile(){write_json(&dir.join("sync-state.json"),&Value::Null)?;}
 write_json(&dir.join("sync-config.json"),&serde_json::to_value(&config).map_err(|_|"同步配置编码失败")?)?;Ok(result)
}
#[tauri::command]
pub fn sync_load_checkpoint(app:tauri::AppHandle)->Result<Value,String>{let _lock=DATA_LOCK.lock().map_err(|_|"数据锁不可用")?;let dir=app.path().app_data_dir().map_err(|_|"数据目录不可用")?;recover(&dir)?;let path=dir.join("sync-state.json");if path.exists(){read_json(&path)}else{Ok(Value::Null)}}
#[tauri::command]
pub fn sync_save_checkpoint(app:tauri::AppHandle,checkpoint:Value)->Result<(),String>{let _lock=DATA_LOCK.lock().map_err(|_|"数据锁不可用")?;let dir=app.path().app_data_dir().map_err(|_|"数据目录不可用")?;recover(&dir)?;check_checkpoint(&checkpoint,&load_config(&dir)?)?;write_json(&dir.join("sync-state.json"),&checkpoint)}
#[tauri::command]
pub fn sync_backup(app:tauri::AppHandle,remote:Value)->Result<(),String>{let _lock=DATA_LOCK.lock().map_err(|_|"数据锁不可用")?;let dir=app.path().app_data_dir().map_err(|_|"数据目录不可用")?;recover(&dir)?;backup(&dir,&remote)}
fn apply(dir:&Path,data:&Value,expected:&Value,checkpoint:&Value)->Result<Value,String>{
 recover(dir)?;check_data(data)?;check_checkpoint(checkpoint,&load_config(dir)?)?;
 if checkpoint["data"]!=*data{return Err("同步检查点与下载数据不一致".into())}
 let local=read_json(&dir.join("tasks.json"))?;let mut prefs=if dir.join("preferences.json").exists(){read_json(&dir.join("preferences.json"))?}else{json!({})};if !prefs.is_object(){prefs=json!({})}
 if project(&local,&prefs)!=*expected{return Err("本机数据在同步期间发生变化，已取消覆盖，请重新同步".into())}
 backup(dir,&json!({"data":data,"revision":checkpoint["revision"],"serverId":checkpoint["serverId"],"userId":checkpoint["userId"]}))?;
 let mut markers=std::collections::HashMap::new();fn remember(items:&Value,out:&mut std::collections::HashMap<String,Value>){if let Some(xs)=items.as_array(){for t in xs{if let (Some(id),Some(at),Some(sent))=(t["id"].as_str(),t["reminderAt"].as_str(),t.get("remindedAt")){out.insert(format!("{id}|{at}"),sent.clone());}remember(&t["children"],out)}}}remember(&local,&mut markers);
 fn restore(items:&Value,markers:&std::collections::HashMap<String,Value>)->Value{Value::Array(items.as_array().unwrap().iter().map(|t|{let mut t=project_task(t);let key=format!("{}|{}",t["id"].as_str().unwrap_or(""),t["reminderAt"].as_str().unwrap_or(""));t["remindedAt"]=markers.get(&key).cloned().unwrap_or(json!(""));if matches!(t["repeat"].as_str(),Some("workday"|"holiday"))&&t["remindedAt"].as_str().unwrap_or("").is_empty()&&t["repeatArchived"]!=true&&t["repeatSeries"].as_str().unwrap_or("").is_empty(){t["repeatPending"]=json!(true);}t["children"]=restore(&t["children"],markers);t}).collect())}
 let tasks=restore(&data["tasks"],&markers);prefs["groups"]=data["groups"].clone();prefs["taskPlacement"]=data["taskPlacement"].clone();
 write_json(&dir.join("sync-apply.pending.json"),&json!({"tasks":tasks,"preferences":prefs,"checkpoint":checkpoint}))?;
 recover(dir)?;Ok(tasks)
}
#[tauri::command]
pub fn sync_apply(app:tauri::AppHandle,data:Value,expected:Value,checkpoint:Value)->Result<Value,String>{let _lock=DATA_LOCK.lock().map_err(|_|"数据锁不可用")?;let dir=app.path().app_data_dir().map_err(|_|"数据目录不可用")?;apply(&dir,&data,&expected,&checkpoint)}

struct Handle(*mut c_void);
impl Handle {fn new(value:*mut c_void)->Result<Self,String>{if value.is_null(){Err(network_error())}else{Ok(Self(value))}}}
impl Drop for Handle {fn drop(&mut self){unsafe{WinHttpCloseHandle(self.0);}}}
fn network_error()->String{let code=unsafe{windows_sys::Win32::Foundation::GetLastError()};match code{12002=>"连接超时，本机数据已保留".into(),12007=>"无法解析同步服务器地址".into(),12175=>"HTTPS 证书校验失败，请检查服务器证书与系统时间".into(),_=>format!("同步网络请求失败（Windows 错误 {code}），本机数据已保留")}}
fn http(config:&Config,secret:&str,method:&str,body:Option<Value>)->Result<Value,String>{
 if !["GET","PUT"].contains(&method){return Err("不支持的同步请求方法".into())}
 let config=config.clone().checked()?;
 let url=config.endpoint()?;let payload=body.map(|v|v.to_string()).unwrap_or_default();if payload.len()>4_000_000{return Err("同步请求超过 4 MB".into())}
 let started=Instant::now();
 unsafe{
  let session=Handle::new(WinHttpOpen(wide("TodoSync/1").as_ptr(),WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,null(),null(),0))?;
  if WinHttpSetTimeouts(session.0,5000,5000,5000,5000)==0{return Err(network_error())}
  let host=url.host_str().ok_or("服务器缺少主机名")?.trim_start_matches('[').trim_end_matches(']');
  let connect=Handle::new(WinHttpConnect(session.0,wide(host).as_ptr(),url.port_or_known_default().ok_or("无效端口")?,0))?;
  let request=Handle::new(WinHttpOpenRequest(connect.0,wide(method).as_ptr(),wide(url.path()).as_ptr(),null(),null(),null(),if url.scheme()=="https"{WINHTTP_FLAG_SECURE}else{0}))?;
  for (option,value) in [(WINHTTP_OPTION_REDIRECT_POLICY,WINHTTP_OPTION_REDIRECT_POLICY_NEVER),(WINHTTP_OPTION_AUTOLOGON_POLICY,WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH),(WINHTTP_OPTION_DISABLE_FEATURE,WINHTTP_DISABLE_COOKIES)]{
   if WinHttpSetOption(request.0,option,(&value as *const u32).cast(),4)==0{return Err(network_error())}
  }
  let mut headers=wide(&format!("Authorization: Bearer {secret}\r\nAccept: application/json\r\nCache-Control: no-cache\r\nContent-Type: application/json\r\n"));
  let sent=WinHttpSendRequest(request.0,headers.as_ptr(),(headers.len()-1) as u32,if payload.is_empty(){null()}else{payload.as_ptr().cast()},payload.len() as u32,payload.len() as u32,0);headers.fill(0);
  if sent==0||WinHttpReceiveResponse(request.0,null_mut())==0{return Err(network_error())}
  let mut status=0u32;let mut size=4u32;
  if WinHttpQueryHeaders(request.0,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,null(),(&mut status as *mut u32).cast(),&mut size,null_mut())==0{return Err(network_error())}
  if status!=200{return Ok(json!({"status":status,"body":null}))}
  let mut data=Vec::new();let mut buffer=[0u8;16384];
  loop{
   if started.elapsed()>Duration::from_secs(20){return Err("同步请求超时，本机数据已保留".into())}
   let mut read=0u32;if WinHttpReadData(request.0,buffer.as_mut_ptr().cast(),buffer.len() as u32,&mut read)==0{return Err(network_error())}if read==0{break}
   if data.len()+read as usize>4_000_000{return Err("服务器数据超过 4 MB，已拒绝读取".into())}data.extend_from_slice(&buffer[..read as usize]);
  }
  let value:Value=serde_json::from_slice(&data).map_err(|_|"服务器未返回有效 JSON，请检查同步接口地址")?;Ok(json!({"status":status,"body":value}))
 }
}
#[tauri::command]
pub async fn sync_http(app:tauri::AppHandle,profile:String,method:String,body:Option<Value>)->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let config={let _lock=DATA_LOCK.lock().map_err(|_|"数据锁不可用")?;let dir=app.path().app_data_dir().map_err(|_|"数据目录不可用")?;ensure_profile(&dir,&profile)?;load_config(&dir)?};
  let mut secret=token(&config)?.ok_or("请先保存同步访问令牌")?;let result=http(&config,&secret,&method,body);unsafe{secret.as_bytes_mut().fill(0)};result
 }).await.map_err(|_|"同步网络工作线程失败".to_string())?
}

#[cfg(test)]
mod tests{
 use super::*;
 struct Temp(std::path::PathBuf);
 impl Temp{fn new()->Self{let p=std::env::temp_dir().join(format!("todo-sync-test-{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap()));std::fs::create_dir_all(&p).unwrap();Self(p)}}
 impl Drop for Temp{fn drop(&mut self){let p=&self.0;if p.starts_with(std::env::temp_dir())&&p.file_name().unwrap().to_string_lossy().starts_with("todo-sync-test-"){let _=std::fs::remove_dir_all(p);}}}
 fn config(server:&str,user:&str)->Config{Config{server:server.into(),user_id:user.into(),..Default::default()}}
 fn fixture()->(Temp,Config,Value,Value){
  let dir=Temp::new();let cfg=config("https://example.test","alice").checked().unwrap();write_json(&dir.0.join("sync-config.json"),&serde_json::to_value(&cfg).unwrap()).unwrap();
  let tasks=json!([{"id":"a","text":"本机","done":false,"collapsed":false,"groupId":"","children":[],"reminderAt":"2026-10-19T00:00:00Z","remindedAt":"local-marker","repeatPending":false}]);
  let prefs=json!({"tools":[{"name":"local","path":"C:/local.md"}],"groups":[],"taskPlacement":{"level1":"top","level2":"bottom","level3":"bottom"}});
  write_json(&dir.0.join("tasks.json"),&tasks).unwrap();write_json(&dir.0.join("preferences.json"),&prefs).unwrap();let base=project(&tasks,&prefs);(dir,cfg,base,tasks)
 }
 #[test]fn sync_schedule_defaults_validation_and_persistence(){
  let legacy:Config=serde_json::from_value(json!({"server":"https://example.test","userId":"alice","enabled":true})).unwrap();
  assert_eq!(legacy.sync_interval_minutes,15);assert!(legacy.sync_on_edit);
  let dir=Temp::new();let mut cfg=legacy;cfg.sync_interval_minutes=7;cfg.sync_on_edit=false;
  write_json(&dir.0.join("sync-config.json"),&serde_json::to_value(&cfg).unwrap()).unwrap();
  let restored=load_config(&dir.0).unwrap();assert_eq!(restored.sync_interval_minutes,7);assert!(!restored.sync_on_edit);
  assert_eq!(cfg.profile(),restored.profile());
  let mut other=cfg.clone();other.sync_interval_minutes=60;other.sync_on_edit=true;assert_eq!(cfg.profile(),other.profile());
  for minutes in [0,1441,u32::MAX]{let mut bad=cfg.clone();bad.sync_interval_minutes=minutes;assert!(bad.checked().is_err());}
  for minutes in [1,15,30,60,1440]{let mut good=cfg.clone();good.sync_interval_minutes=minutes;assert!(good.checked().is_ok());}
 }
 #[test]fn endpoint_and_https_validation(){
  assert!(config("http://example.test","alice").checked().is_err());assert!(config("https://user:password@example.test","alice").checked().is_err());assert!(config("https://example.test?token=x","alice").checked().is_err());assert!(config("https://example.test","../bob").checked().is_err());
  let cfg=config("https://EXAMPLE.test/todo/","alice").checked().unwrap();assert_eq!(cfg.endpoint().unwrap().as_str(),"https://example.test/todo/api/v1/users/alice/sync");assert!(config("http://127.0.0.1:8080","default").checked().is_ok());
 }
 #[test]fn remote_http_opt_in_and_https_upgrade(){
  let address="http://203.0.113.10:18080/todo";
  assert!(http(&config(address,"alice"),"mock-token","GET",None).unwrap_err().contains("允许 HTTP"));
  let mut allowed=config(address,"alice");allowed.allow_http=true;let allowed=allowed.checked().unwrap();
  assert_eq!(allowed.endpoint().unwrap().as_str(),"http://203.0.113.10:18080/todo/api/v1/users/alice/sync");
  let dir=Temp::new();write_json(&dir.0.join("sync-config.json"),&serde_json::to_value(&allowed).unwrap()).unwrap();
  assert!(load_config(&dir.0).unwrap().allow_http);
  let mut upgraded=allowed.clone();upgraded.server="https://todo.example.test/todo".into();upgraded.allow_http=false;let upgraded=upgraded.checked().unwrap();
  assert_eq!(upgraded.endpoint().unwrap().as_str(),"https://todo.example.test/todo/api/v1/users/alice/sync");
  assert_ne!(allowed.profile(),upgraded.profile());assert_ne!(allowed.target(),upgraded.target());
  let legacy:Config=serde_json::from_value(json!({"server":"https://todo.example.test","userId":"alice","enabled":false})).unwrap();
  assert!(!legacy.clone().checked().unwrap().allow_http);
  for address in ["http://localhost:8080","http://127.0.0.1:8080","http://[::1]:8080"]{assert!(config(address,"alice").checked().is_ok());}
  for address in ["ftp://example.test","http://user:password@example.test","http://example.test?token=x","http://example.test/#x"]{let mut cfg=config(address,"alice");cfg.allow_http=true;assert!(cfg.checked().is_err());}
 }
 #[test]fn apply_preserves_tools_and_device_notification_markers(){
  let (dir,cfg,base,_)=fixture();let mut data=base.clone();data["tasks"][0]["text"]=json!("云端");
  let cp=json!({"profile":cfg.profile(),"serverId":"test","userId":"alice","revision":2,"lastSyncAt":"2026-10-19T00:00:00Z","data":data});
  let result=apply(&dir.0,&data,&base,&cp).unwrap();assert_eq!(result[0]["remindedAt"],"local-marker");assert_eq!(result[0]["text"],"云端");assert!(result[0].get("repeatPending").is_none());
  let prefs=read_json(&dir.0.join("preferences.json")).unwrap();assert_eq!(prefs["tools"][0]["path"],"C:/local.md");assert_eq!(read_json(&dir.0.join("sync-state.json")).unwrap(),cp);assert!(!dir.0.join("sync-apply.pending.json").exists());
  assert_eq!(std::fs::read_dir(dir.0.join("sync-backups")).unwrap().count(),1);
 }
 #[test]fn repaired_local_groups_match_native_apply_expectation(){
  let (dir,cfg,_,mut old)=fixture();old[0]["groupId"]=json!("deleted-group");
  write_json(&dir.0.join("tasks.json"),&old).unwrap();
  let repaired=crate::task_groups::repair_local(&dir.0,old).unwrap();
  let prefs=read_json(&dir.0.join("preferences.json")).unwrap();let expected=project(&repaired,&prefs);
  let mut data=expected.clone();data["tasks"][0]["text"]=json!("remote after migration");
  let cp=json!({"profile":cfg.profile(),"serverId":"test","userId":"alice","revision":1,"lastSyncAt":"2026-10-19T00:00:00Z","data":data});
  assert_eq!(apply(&dir.0,&data,&expected,&cp).unwrap()[0]["text"],"remote after migration");
 }
 #[test]fn reject_changed_local_and_wrong_account_without_writes(){
  let (dir,cfg,base,old)=fixture();let mut data=base.clone();data["tasks"][0]["text"]=json!("云端");let cp=json!({"profile":cfg.profile(),"serverId":"test","userId":"alice","revision":2,"lastSyncAt":"2026-10-19T00:00:00Z","data":data});
  assert!(apply(&dir.0,&data,&json!({}),&cp).is_err());assert_eq!(read_json(&dir.0.join("tasks.json")).unwrap(),old);
  let mut wrong=cp.clone();wrong["userId"]=json!("bob");assert!(apply(&dir.0,&data,&base,&wrong).is_err());assert_eq!(read_json(&dir.0.join("tasks.json")).unwrap(),old);
 }
 #[test]fn interrupted_commit_completes_from_journal(){
  let (dir,cfg,mut data,_)=fixture();data["tasks"][0]["text"]=json!("恢复完成");let prefs=json!({"tools":[],"groups":[],"taskPlacement":data["taskPlacement"]});let cp=json!({"profile":cfg.profile(),"serverId":"test","userId":"alice","revision":9,"lastSyncAt":"2026-10-19T00:00:00Z","data":data});
  write_json(&dir.0.join("sync-apply.pending.json"),&json!({"tasks":data["tasks"],"preferences":prefs,"checkpoint":cp})).unwrap();recover(&dir.0).unwrap();assert_eq!(read_json(&dir.0.join("tasks.json")).unwrap()[0]["text"],"恢复完成");assert_eq!(read_json(&dir.0.join("sync-state.json")).unwrap()["revision"],9);assert!(!dir.0.join("sync-apply.pending.json").exists());
 }
 #[test]fn downloaded_holiday_task_waits_for_local_calendar_validation(){
  let (dir,cfg,base,_)=fixture();let mut data=base.clone();data["tasks"][0]["id"]=json!("new-on-this-device");data["tasks"][0]["repeat"]=json!("workday");
  let cp=json!({"profile":cfg.profile(),"serverId":"test","userId":"alice","revision":2,"lastSyncAt":"2026-10-19T00:00:00Z","data":data});
  let result=apply(&dir.0,&data,&base,&cp).unwrap();assert_eq!(result[0]["repeatPending"],true);assert_eq!(result[0]["remindedAt"],"");
 }
 #[test]fn native_transport_blocks_redirect_and_auth_leak(){
  use std::io::{Read,Write};let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let port=listener.local_addr().unwrap().port();
  let server=std::thread::spawn(move||{let (mut socket,_)=listener.accept().unwrap();socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();let mut buf=[0u8;8192];let n=socket.read(&mut buf).unwrap();let headers=String::from_utf8_lossy(&buf[..n]);assert!(headers.contains("/api/v1/users/alice/sync"));assert!(headers.contains("Authorization: Bearer mock-token"));socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/leak\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();});
  let cfg=config(&format!("http://127.0.0.1:{port}"),"alice").checked().unwrap();let result=http(&cfg,"mock-token","GET",None).unwrap();assert_eq!(result["status"],302);server.join().unwrap();
 }
}
