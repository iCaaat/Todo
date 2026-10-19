use std::{collections::HashSet,path::Path};
use serde_json::{json,Value};
use super::{read_json,write_json};

// Called under DATA_LOCK, after journal recovery and before returning local tasks.
// Read the persisted groups here so asynchronous frontend loads cannot erase them.
pub(super) fn repair_local(dir:&Path,mut tasks:Value)->Result<Value,String>{
 let prefs_path=dir.join("preferences.json");
 if !prefs_path.exists(){return Ok(tasks)} // Older installations may still use localStorage.
 let prefs=read_json(&prefs_path)?;
 let groups=match prefs["groups"].as_array(){Some(groups)=>groups,None=>return Ok(tasks)};
 let mut ids=HashSet::new();
 for group in groups{
  match group["id"].as_str(){Some(id) if !id.is_empty()=>{ids.insert(id.to_owned());},_=>return Ok(tasks)}
 }
 fn clear(items:&mut Value,ids:&HashSet<String>)->bool{
  let mut changed=false;
  if let Some(items)=items.as_array_mut(){for task in items{
   if task["groupId"].as_str().is_some_and(|id|!id.is_empty()&&!ids.contains(id)){
    task["groupId"]=json!("");changed=true;
   }
   if let Some(children)=task.get_mut("children"){changed=clear(children,ids)||changed;}
  }}
  changed
 }
 let original=tasks.clone();
 if clear(&mut tasks,&ids){
  let folder=dir.join("group-repair-backups");
  std::fs::create_dir_all(&folder).map_err(|e|format!("分组修复备份失败，未修改任务：{e}"))?;
  let name=format!("before-repair-{}.json",chrono::Utc::now().format("%Y%m%dT%H%M%S%.9f"));
  write_json(&folder.join(name),&json!({"tasks":original,"preferences":prefs}))?;
  write_json(&dir.join("tasks.json"),&tasks)?;
 }
 Ok(tasks)
}

#[cfg(test)]
mod tests{
 use super::*;
 struct Temp(std::path::PathBuf);
 impl Temp{fn new()->Self{let path=std::env::temp_dir().join(format!("todo-group-test-{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap()));std::fs::create_dir_all(&path).unwrap();Self(path)}}
 impl Drop for Temp{fn drop(&mut self){if self.0.starts_with(std::env::temp_dir())&&self.0.file_name().unwrap().to_string_lossy().starts_with("todo-group-test-"){let _=std::fs::remove_dir_all(&self.0);}}}
 #[test]fn repair_preserves_everything_except_unknown_group_references(){
  let dir=Temp::new();
  let original=json!([{"id":"root","text":"keep","done":false,"groupId":"gone","reminderAt":"2026-10-20T00:00:00Z","repeat":"daily","repeatSeries":"series","children":[{"id":"child","done":true,"groupId":"valid","children":[{"id":"leaf","groupId":"gone","remindedAt":"marker","children":[]}]}]},{"id":"ungrouped","groupId":"","children":[]}]);
  let prefs=json!({"groups":[{"id":"valid","name":"keep"}],"tools":[{"path":"C:/local.md"}],"taskPlacement":{"level1":"top"}});
  write_json(&dir.0.join("tasks.json"),&original).unwrap();write_json(&dir.0.join("preferences.json"),&prefs).unwrap();
  let actual=repair_local(&dir.0,original.clone()).unwrap();
  let mut expected=original.clone();expected[0]["groupId"]=json!("");expected[0]["children"][0]["children"][0]["groupId"]=json!("");
  assert_eq!(actual,expected);assert_eq!(read_json(&dir.0.join("tasks.json")).unwrap(),expected);
  assert_eq!(read_json(&dir.0.join("preferences.json")).unwrap(),prefs);
  let backups=std::fs::read_dir(dir.0.join("group-repair-backups")).unwrap().map(|x|x.unwrap().path()).collect::<Vec<_>>();
  assert_eq!(backups.len(),1);assert_eq!(read_json(&backups[0]).unwrap(),json!({"tasks":original,"preferences":prefs}));
  assert_eq!(repair_local(&dir.0,expected.clone()).unwrap(),expected);
  assert_eq!(std::fs::read_dir(dir.0.join("group-repair-backups")).unwrap().count(),1);
 }
 #[test]fn missing_or_unusable_groups_do_not_guess_legacy_group_membership(){
  let dir=Temp::new();let original=json!([{"groupId":"legacy","children":[]}]);
  assert_eq!(repair_local(&dir.0,original.clone()).unwrap(),original);
  for prefs in [json!({"tools":[]}),json!({"groups":[{"name":"no id"}]})]{
   write_json(&dir.0.join("preferences.json"),&prefs).unwrap();assert_eq!(repair_local(&dir.0,original.clone()).unwrap(),original);
  }
  assert!(!dir.0.join("tasks.json").exists());assert!(!dir.0.join("group-repair-backups").exists());
 }
 #[test]fn backup_failure_prevents_task_rewrite(){
  let dir=Temp::new();let original=json!([{"groupId":"gone","children":[]}]);
  write_json(&dir.0.join("tasks.json"),&original).unwrap();write_json(&dir.0.join("preferences.json"),&json!({"groups":[]})).unwrap();
  std::fs::write(dir.0.join("group-repair-backups"),b"blocked").unwrap();
  assert!(repair_local(&dir.0,original.clone()).is_err());assert_eq!(read_json(&dir.0.join("tasks.json")).unwrap(),original);
 }
}
