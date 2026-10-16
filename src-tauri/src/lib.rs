use std::{collections::HashSet, sync::Mutex, time::Duration};
use tauri::{Manager, Emitter, WebviewUrl, WebviewWindowBuilder, menu::{Menu,MenuItem}, tray::{TrayIconBuilder,TrayIconEvent,MouseButton,MouseButtonState}};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

static DATA_LOCK:Mutex<()> = Mutex::new(());
fn read_json(path:&std::path::Path)->Result<serde_json::Value,String>{
 if !path.exists(){return Ok(serde_json::json!([]))}
 serde_json::from_slice(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())
}
fn write_json(path:&std::path::Path,value:&serde_json::Value)->Result<(),String>{
 let temp=path.with_extension("tmp");
 std::fs::write(&temp,serde_json::to_vec_pretty(value).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 std::fs::copy(&temp,path).map_err(|e|e.to_string())?;
 let _=std::fs::remove_file(temp);
 Ok(())
}
#[tauri::command]
fn load_tasks(app:tauri::AppHandle)->Result<serde_json::Value,String>{
 let _lock=DATA_LOCK.lock().map_err(|e|e.to_string())?;
 read_json(&app.path().app_data_dir().map_err(|e|e.to_string())?.join("tasks.json"))
}
#[tauri::command]
fn save_tasks(app:tauri::AppHandle,tasks:serde_json::Value)->Result<(),String>{
 let _lock=DATA_LOCK.lock().map_err(|e|e.to_string())?;
 let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;
 std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 let path=dir.join("tasks.json");
 if path.exists(){let _=std::fs::copy(&path,dir.join("tasks.backup.json"));}
 write_json(&path,&tasks)
}
#[tauri::command]
fn load_preferences(app:tauri::AppHandle)->Result<serde_json::Value,String>{
 let path=app.path().app_data_dir().map_err(|e|e.to_string())?.join("preferences.json");
 if !path.exists(){return Ok(serde_json::Value::Null)}
 read_json(&path)
}
#[tauri::command]
fn save_preferences(app:tauri::AppHandle,state:serde_json::Value)->Result<(),String>{
 let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;
 std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 write_json(&dir.join("preferences.json"),&state)
}
fn due_tasks(tasks:&serde_json::Value,now:i64,result:&mut Vec<(String,String)>){
 if let Some(items)=tasks.as_array(){for t in items{
 if t["done"].as_bool()!=Some(true){
 if let (Some(id),Some(at))=(t["id"].as_str(),t["reminderAt"].as_str()){
 if let Ok(time)=chrono::DateTime::parse_from_rfc3339(at){
 if time.timestamp()<=now{result.push((format!("{id}|{at}"),t["text"].as_str().unwrap_or("待办任务").to_string()));}
 }}
 }
 due_tasks(&t["children"],now,result);
 }}
}
fn reminder_tick(app:&tauri::AppHandle)->Result<(),String>{
 let _lock=DATA_LOCK.lock().map_err(|e|e.to_string())?;
 let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;
 let tasks=read_json(&dir.join("tasks.json"))?;
 let mut due=vec![];due_tasks(&tasks,chrono::Utc::now().timestamp(),&mut due);
 if due.is_empty(){return Ok(())}
 let ledger_path=dir.join("reminders-sent.json");
 let mut sent:HashSet<String>=serde_json::from_value(read_json(&ledger_path)?).map_err(|e|e.to_string())?;
 for (key,body) in due{
 if sent.contains(&key){continue}
 app.notification().builder().title("AIP Todo 提醒").body(body).show().map_err(|e|e.to_string())?;
 sent.insert(key);
 write_json(&ledger_path,&serde_json::to_value(&sent).map_err(|e|e.to_string())?)?;
 }
 Ok(())
}
#[tauri::command]
fn test_notification(app:tauri::AppHandle)->Result<(),String>{
 app.notification().builder().title("AIP Todo").body("测试通知：你的待办提醒已准备就绪。").show().map_err(|e|e.to_string())
}
#[tauri::command]
fn open_calendar(app:tauri::AppHandle)->Result<(),String>{
 if let Some(w)=app.get_webview_window("calendar"){let _=w.show();let _=w.set_focus();return Ok(())}
 WebviewWindowBuilder::new(&app,"calendar",WebviewUrl::App("calendar.html".into())).title("Todo 日历").inner_size(720.0,620.0).resizable(true).build().map(|_|()).map_err(|e|e.to_string())
}#[tauri::command]
fn open_tool(app:tauri::AppHandle,path:String)->Result<(),String>{
 let base=app.path().resource_dir().or_else(|_|app.path().app_data_dir()).map_err(|e|e.to_string())?;
 let full=if path.starts_with("builtin/"){base.join("tools").join(path.trim_start_matches("builtin/"))}else{std::path::PathBuf::from(path)};
 if !full.exists(){return Err(format!("工具不存在：{}",full.display()))}
 unsafe { use std::os::windows::ffi::OsStrExt; let wide:Vec<u16>=std::ffi::OsStr::new(&full).encode_wide().chain(std::iter::once(0)).collect(); windows_sys::Win32::UI::Shell::ShellExecuteW(std::ptr::null_mut(),std::ptr::null(),wide.as_ptr(),std::ptr::null(),std::ptr::null(),1); } Ok(())
}
#[tauri::command]
fn set_pinned(window:tauri::WebviewWindow,value:bool)->Result<(),String>{window.set_always_on_top(value).map_err(|e|e.to_string())}
#[tauri::command]
fn hide_window(window:tauri::WebviewWindow)->Result<(),String>{window.hide().map_err(|e|e.to_string())}
#[tauri::command]
fn get_startup(app:tauri::AppHandle)->Result<bool,String>{app.autolaunch().is_enabled().map_err(|e|e.to_string())}
#[tauri::command]
fn set_startup(app:tauri::AppHandle,value:bool)->Result<(),String>{
 if value{app.autolaunch().enable()}else{app.autolaunch().disable()}.map_err(|e|e.to_string())
}
pub fn run(){
 tauri::Builder::default()
 .plugin(tauri_plugin_autostart::Builder::new().build())
 .plugin(tauri_plugin_dialog::init())
 .plugin(tauri_plugin_notification::init())
 .invoke_handler(tauri::generate_handler![load_tasks,save_tasks,load_preferences,save_preferences,set_pinned,open_tool,hide_window,get_startup,set_startup,test_notification,open_calendar])
 .setup(|app|{
 let show=MenuItem::with_id(app,"show","显示待办",true,None::<&str>)?;
 let quit=MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;
 let menu=Menu::with_items(app,&[&show,&quit])?;
 TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).tooltip("AIP Todo").menu(&menu)
 .show_menu_on_left_click(false)
 .on_menu_event(|app,event|match event.id.as_ref(){
 "quit"=>app.exit(0),
 "show"=>{if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();}},
 _=>{}
 })
 .on_tray_icon_event(|tray,event|{if let TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}=event{if let Some(w)=tray.app_handle().get_webview_window("main"){let _=w.show();let _=w.set_focus();}}})
 .build(app)?;
 let handle=app.handle().clone();
 std::thread::spawn(move||loop{
 if let Err(e)=reminder_tick(&handle){let _=handle.emit("reminder-error",e);}
 std::thread::sleep(Duration::from_secs(5));
 });
 Ok(())
 })
 .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{if window.label()=="main"{if window.hide().is_ok(){api.prevent_close();}}}})
 .run(tauri::generate_context!()).expect("启动 AIP Todo 失败");
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test] fn nested_due_and_completed(){
 let tasks=serde_json::json!([{"id":"a","text":"parent","done":false,"reminderAt":"2026-01-01T00:00:00Z","children":[
 {"id":"b","text":"done","done":true,"reminderAt":"2026-01-01T00:00:00Z","children":[]},
 {"id":"c","text":"future","done":false,"reminderAt":"2099-01-01T00:00:00Z","children":[]},
 {"id":"d","text":"nested","done":false,"reminderAt":"2026-01-01T08:00:00+08:00","children":[]}
 ]}]);
 let mut due=vec![];due_tasks(&tasks,1767225600,&mut due);
 assert_eq!(due.len(),2);assert_eq!(due[1].1,"nested");
 }
 #[test] fn legacy_and_invalid_dates(){
 let tasks=serde_json::json!([{"id":"legacy","children":[]},{"id":"bad","reminderAt":"bad","children":[]}]);
 let mut due=vec![];due_tasks(&tasks,i64::MAX,&mut due);assert!(due.is_empty());
 }
}















