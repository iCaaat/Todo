import React,{useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {invoke} from "@tauri-apps/api/core";
import {sendNotification} from "@tauri-apps/plugin-notification";
import {open} from "@tauri-apps/plugin-dialog";
import "./style.css";
import {Task,expandRecurringTasks,resetRepeat,alignHolidayTask} from "./recurrence";
import {TaskOptions} from "./TaskOptions";
import {removeTaskGroup} from "./taskGroups";
import {formatListMarker} from "./taskNumbering";
import {TaskPlacement,DEFAULT_PLACEMENT,normalizePlacement,positionAt,insertTask} from "./taskPlacement";
import {WorkCalendar,CalendarPage} from "./Calendar";
import {useHolidays} from "./useHolidays";
import {useSync} from "./useSync";
import {SyncSettings,SyncConflictDialog} from "./SyncSettings";
import {Checkpoint,SyncData,fingerprint,syncData} from "./sync";
import {hasHolidayYear,isHolidayRepeat} from "./holidays";
type TaskGroup={id:string;name:string;color:string;collapsed?:boolean};
const GROUP_COLORS=["#4b9b72","#4f83bd","#c58a3d","#8b6bb1","#c76565","#5e9c9c"];
const fresh=(text:string):Task=>({id:crypto.randomUUID(),text,done:false,collapsed:false,children:[],reminder:"",groupId:""});
const update=(xs:Task[],id:string,fn:(t:Task)=>Task):Task[]=>xs.map(t=>t.id===id?fn(t):{...t,children:update(t.children,id,fn)});
const remove=(xs:Task[],id:string):Task[]=>xs.filter(t=>t.id!==id).map(t=>({...t,children:remove(t.children,id)}));
const removeDone=(xs:Task[]):Task[]=>xs.filter(t=>!t.done).map(t=>({...t,children:removeDone(t.children)}));
const complete=(t:Task,done:boolean):Task=>({...t,done,children:t.children.map(c=>complete(c,done))});
const reorder=(xs:Task[],a:string,b:string):Task[]=>{const i=xs.findIndex(t=>t.id===a),j=xs.findIndex(t=>t.id===b);if(i>=0&&j>=0){const n=[...xs],[x]=n.splice(i,1);n.splice(j,0,x);return n}return xs.map(t=>({...t,children:reorder(t.children,a,b)}))};
const flatten=(xs:Task[]):Task[]=>xs.flatMap(t=>[t,...flatten(t.children)]);
const TOOL_ICONS=["▤","◫","▥","▰","◉","★","◆","✎","☑","⌂","⚙","⌕","➤","☰","📁","📄","📌","🔗","📊","🗂","📝","📅","🧰","🖼","🎵","🎬","✉","🔔","💡","⚡","🛠","🧮","💻","🌐","📦","🗃","✅","🚀"];
const displayTime=(t:string)=>{const d=new Date(t);return Number.isNaN(d.getTime())?"":d.toLocaleString([], {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})};
function App(){
 const holidays=useHolidays();
 const focusTask=useRef<string|null>(null);
 const insertAfter=(items:Task[],id:string,next:Task):Task[]=>items.flatMap(t=>t.id===id?[t,next]:[{...t,children:insertAfter(t.children,id,next)}]);
 const addSibling=(event:React.KeyboardEvent<HTMLInputElement>,task:Task)=>{
   if(event.key!=="Tab"||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||event.nativeEvent.isComposing)return;
   event.preventDefault();if(!task.text.trim())return;
   const next={...fresh(""),groupId:task.groupId||""};
   focusTask.current=next.id;setTasks(items=>insertAfter(items,task.id,next));
 };
 const [tasks,setTasks]=useState<Task[]>([]),[ready,setReady]=useState(false),[text,setText]=useState("") ,[newGroupId,setNewGroupId]=useState(""),[error,setError]=useState(""),[toast,setToast]=useState(""),[settings,setSettings]=useState(false),[pinned,setPinned]=useState(true),[startup,setStartup]=useState(false),[drag,setDrag]=useState<string|null>(null),[editing,setEditing]=useState<string|null>(null),[optionsTask,setOptionsTask]=useState<string|null>(null),[pending,setPending]=useState<Task|null>(null),[clearConfirm,setClearConfirm]=useState(false),[toolsOpen,setToolsOpen]=useState(false),[toolsEdit,setToolsEdit]=useState(false),[calendarOpen,setCalendarOpen]=useState(false),[userTools,setUserTools]=useState<{name:string;path:string;icon?:string}[]>(()=>{try{return JSON.parse(localStorage.getItem("todo-tools")||"[]")}catch{return []}}),[completedOpen,setCompletedOpen]=useState(true),[iconPicker,setIconPicker]=useState<string|null>(null),[groups,setGroups]=useState<TaskGroup[]>(()=>{try{return JSON.parse(localStorage.getItem("todo-groups")||"[]")}catch{return []}}),[prefsReady,setPrefsReady]=useState(false),[groupEditor,setGroupEditor]=useState(false),[groupForm,setGroupForm]=useState<{id?:string;name:string;color:string}>({name:"",color:GROUP_COLORS[0]});
 const [taskPlacement,setTaskPlacement]=useState<TaskPlacement>(DEFAULT_PLACEMENT);
 const preferenceQueue=useRef<Promise<void>>(Promise.resolve());
 const applyingSync=useRef(false);const [syncApplying,setSyncApplying]=useState(false),[syncFatal,setSyncFatal]=useState(false);
 const optionsAnchor=useRef<HTMLElement|null>(null);
 const [clock,setClock]=useState(Date.now());
 const queue=useRef<Promise<void>>(Promise.resolve()); const [startupBusy,setStartupBusy]=useState(false);
 const localSyncData=syncData(tasks,groups,taskPlacement);
 const localSyncRef=useRef(localSyncData);localSyncRef.current=localSyncData;
 const restoreDisk=async()=>{
   const [diskTasks,prefs]=await Promise.all([invoke<Task[]>("load_tasks"),invoke<any>("load_preferences")]);
   setTasks(diskTasks);setGroups(Array.isArray(prefs?.groups)?prefs.groups:[]);setTaskPlacement(normalizePlacement(prefs?.taskPlacement));setSyncFatal(false);
 };
 const applySync=async(data:SyncData,expected:SyncData,checkpoint:Checkpoint)=>{
   applyingSync.current=true;setSyncApplying(true);let attempted=false;
   try{
     await queue.current;await preferenceQueue.current;
     if(fingerprint(localSyncRef.current)!==fingerprint(expected))throw new Error("本机数据在同步期间发生变化，请重新同步");
     attempted=true;const merged=await invoke<Task[]>("sync_apply",{data,expected,checkpoint});
     setTasks(merged);setGroups(data.groups);setTaskPlacement(data.taskPlacement);setOptionsTask(null);setGroupEditor(false);
   }catch(error){if(attempted){try{await restoreDisk();}catch{setSyncFatal(true);setError("本地同步写入未完成，请重新读取或重启应用以完成恢复；同步备份已保留。");}}throw error;}
   finally{applyingSync.current=false;setSyncApplying(false);}
 };
 const sync=useSync({ready:ready&&prefsReady&&!syncApplying&&!syncFatal,signature:fingerprint(localSyncData),read:()=>localSyncRef.current,apply:applySync});
 useEffect(()=>{invoke<Task[]>("load_tasks").then(x=>{setTasks(x.map(t=>({...t,groupId:t.groupId||""})));setReady(true)}).catch(e=>setError("读取失败："+e));invoke<any>("load_preferences").then(p=>{if(p&&typeof p==="object"&&!Array.isArray(p)){setUserTools(Array.isArray(p.tools)?p.tools:[]);setGroups(Array.isArray(p.groups)?p.groups:[]);setTaskPlacement(normalizePlacement(p.taskPlacement))}else{try{setUserTools(JSON.parse(localStorage.getItem("todo-tools")||"[]"));setGroups(JSON.parse(localStorage.getItem("todo-groups")||"[]"))}catch{}}setPrefsReady(true)}).catch(()=>{try{setUserTools(JSON.parse(localStorage.getItem("todo-tools")||"[]"));setGroups(JSON.parse(localStorage.getItem("todo-groups")||"[]"))}catch{}setPrefsReady(true)});invoke<boolean>("get_startup").then(setStartup).catch(e=>setError("读取开机自启状态失败："+e));},[]);
 useEffect(()=>{
   if(!prefsReady||applyingSync.current||syncFatal)return;
   const state={tools:userTools,groups,taskPlacement};
   preferenceQueue.current=preferenceQueue.current.then(async()=>{
     try{await invoke("save_preferences",{state})}catch(e){setError("保存用户设置失败："+e)}
   });
 },[userTools,groups,taskPlacement,prefsReady,syncApplying,syncFatal]);
 useEffect(()=>{if(prefsReady&&newGroupId&&!groups.some(g=>g.id===newGroupId))setNewGroupId("")},[groups,newGroupId,prefsReady]);
 useEffect(()=>{if(!ready||applyingSync.current||syncFatal)return;queue.current=queue.current.then(async()=>{try{await invoke("save_tasks",{tasks})}catch(e){setError("保存失败："+e)}});},[tasks,ready,syncApplying,syncFatal]);
 useEffect(()=>{
   if(!ready||!prefsReady||!holidays.ready||syncApplying||syncFatal)return;
   const tick=()=>{
     const now=Date.now();setClock(now);
     let next=expandRecurringTasks(tasks,now,taskPlacement,holidays.cache);
     const due=flatten(next).filter(t=>!t.done&&!t.repeatPending&&!t.remindedAt&&t.reminderAt&&Date.parse(t.reminderAt)<=now);
     if(due.length){
       const ids=new Set(due.map(t=>t.id));
       const mark=(ts:Task[]):Task[]=>ts.map(t=>({...t,remindedAt:ids.has(t.id)?new Date(now).toISOString():t.remindedAt,children:mark(t.children)}));
       next=mark(next);setToast(due.map(t=>"待办提醒："+t.text).join("；"));
     }
     if(next!==tasks)setTasks(next);
   };
   tick();const h=window.setInterval(tick,5000);
   window.addEventListener("focus",tick);document.addEventListener("visibilitychange",tick);
   return()=>{window.clearInterval(h);window.removeEventListener("focus",tick);document.removeEventListener("visibilitychange",tick);};
 },[ready,prefsReady,tasks,taskPlacement,holidays.ready,holidays.cache,syncApplying,syncFatal]); useEffect(()=>{if(!toast)return;const h=window.setTimeout(()=>setToast(""),8000);return()=>window.clearTimeout(h)},[toast]);
 const setToolIcon=(path:string,file:File)=>{const reader=new FileReader();reader.onload=()=>{const next=userTools.map(x=>x.path===path?{...x,icon:String(reader.result)}:x);setUserTools(next);localStorage.setItem("todo-tools",JSON.stringify(next))};reader.readAsDataURL(file)}; const addTool=async(directory=false)=>{const selected=await open({multiple:false,directory});if(typeof selected!=="string")return;const name=selected.split(/[\\/]/).pop()||"新工具";const next=[...userTools,{name,path:selected}];setUserTools(next);localStorage.setItem("todo-tools",JSON.stringify(next))};
 const test=()=>{setToast("测试通知：提醒功能已触发");try{sendNotification({title:"AIP Todo",body:"测试通知：提醒功能已触发"})}catch{}};
 const saveGroup=()=>{const name=groupForm.name.trim();if(!name)return;if(groupForm.id)setGroups(gs=>gs.map(g=>g.id===groupForm.id?{...g,name,color:groupForm.color}:g));else setGroups(gs=>[...gs,{id:crypto.randomUUID(),name,color:groupForm.color}]);setGroupForm({name:"",color:GROUP_COLORS[0]})};
 const deleteGroup=(id:string)=>{setGroups(gs=>gs.filter(g=>g.id!==id));setTasks(ts=>removeTaskGroup(ts,id))};
 const moveGroup=(id:string,direction:number)=>setGroups(gs=>{
   const index=gs.findIndex(g=>g.id===id),target=index+direction;
   if(index<0||target<0||target>=gs.length)return gs;
   const next=[...gs];[next[index],next[target]]=[next[target],next[index]];return next;
 });
 const grouped=(done:boolean,id:string)=>tasks.filter(t=>t.done===done&&t.groupId===id);
 const setReminder=(t:Task,value:string)=>{
   const date=value?new Date(value):null;
   if(date&&!Number.isFinite(date.getTime()))return;
   const at=date?date.toISOString():"";
   setTasks(x=>update(x,t.id,y=>alignHolidayTask({...resetRepeat(y),repeat:y.repeatArchived?"":y.repeat,reminder:value,reminderAt:at,remindedAt:""},holidays.cache)));
 };
 function row(t:Task,depth:number,listMarker=""){return <li key={t.id}><div className="row" onDragOver={e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect="move"}} onDrop={e=>{e.preventDefault();e.stopPropagation();if(drag&&drag!==t.id)setTasks(x=>reorder(x,drag,t.id));setDrag(null)}}><button className="dragHandle" draggable aria-label="拖动排序" onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("text/plain",t.id);e.dataTransfer.effectAllowed="move";setDrag(t.id)}} onDragEnd={()=>setDrag(null)}>⋮⋮</button><button className="fold" disabled={!t.children.length} onClick={()=>setTasks(x=>update(x,t.id,y=>({...y,collapsed:!y.collapsed})))}>{t.children.length?(t.collapsed?"▸":"▾"):"·"}</button><input type="checkbox" checked={t.done} onChange={e=>{const done=e.currentTarget.checked;setTasks(x=>update(x,t.id,y=>complete(y,done)))}}/>{listMarker&&<span className="taskNumber">{listMarker}</span>}<input className="taskText" data-task-id={t.id} ref={element=>{if(element&&focusTask.current===t.id){element.focus();focusTask.current=null;}}} onKeyDown={event=>addSibling(event,t)} title={t.text} value={t.text} onChange={e=>setTasks(x=>update(x,t.id,y=>({...y,text:e.target.value})))}/>{t.reminderAt&&<span className={(!t.done&&Date.parse(t.reminderAt)<clock)?"reminderTime overdue":"reminderTime"} title={(!t.done&&Date.parse(t.reminderAt)<clock)?"已过期，尚未完成":"提醒时间"}>{displayTime(t.reminderAt)}</span>}{depth<3&&<button className="iconBtn addBtn glyphBtn" title="添加子任务" onClick={()=>setTasks(x=>update(x,t.id,y=>({...y,collapsed:false,children:insertTask(y.children,fresh("新子任务"),positionAt(taskPlacement,depth+1))})))}>＋</button>}<button className="iconBtn deleteBtn glyphBtn" title="删除任务" onClick={()=>setPending(t)}>×</button><button className="iconBtn optionsBtn" title="选项" onClick={e=>{e.stopPropagation();optionsAnchor.current=e.currentTarget;setOptionsTask(optionsTask===t.id?null:t.id)}}>⋯</button>{optionsTask===t.id&&optionsAnchor.current&&<TaskOptions key={t.id} task={t} rootTask={depth===1} allowList={depth<3} groups={groups} calendar={holidays.cache} anchor={optionsAnchor.current}
 onListStyle={childListStyle=>setTasks(x=>update(x,t.id,y=>({...y,childListStyle})))}
 onGroup={groupId=>setTasks(x=>update(x,t.id,y=>({...y,groupId})))}
 onReminder={value=>setReminder(t,value)}
 onRepeat={repeat=>setTasks(x=>update(x,t.id,y=>alignHolidayTask({...resetRepeat(y),repeat},holidays.cache)))}
 onClose={()=>setOptionsTask(null)}/>}</div>{!t.collapsed&&t.children.length>0&&<ul>{t.children.map((c,index)=>row(c,depth+1,formatListMarker(t.childListStyle,index)))}</ul>}</li>} const taskList=(done:boolean)=><>{tasks.filter(t=>t.done===done&&!(t.groupId||"")).map(t=>row(t,1))}{groups.map(g=>{const items=grouped(done,g.id);if(!items.length)return null;return <React.Fragment key={g.id}><li className="groupHeader" style={{"--group-color":g.color} as React.CSSProperties}><button onClick={()=>setGroups(gs=>gs.map(x=>x.id===g.id?{...x,collapsed:!x.collapsed}:x))}><span>{g.name}</span><small>{items.length} 项</small><b>{g.collapsed?"＋":"−"}</b></button></li>{!g.collapsed&&items.map(t=>row(t,1))}</React.Fragment>})}</>;
 return <><main inert={syncApplying||syncFatal}>{calendarOpen&&<div className="calendarPanel"><div className="calendarPanelHead"><b>Todo 日历</b><button onClick={()=>setCalendarOpen(false)}>×</button></div><WorkCalendar {...holidays}/></div>}<header><div><h1>Todo</h1></div><button onClick={()=>{setToolsEdit(false);setIconPicker(null);setToolsOpen(true)}}>工具箱</button><button className={pinned?"active":""} onClick={async()=>{try{await invoke("set_pinned",{value:!pinned});setPinned(!pinned)}catch(e){setError(String(e))}}}>{pinned?"已置顶":"置顶"}</button><button title="设置" aria-label="设置" onClick={()=>setSettings(!settings)}>⚙</button></header>{toolsOpen&&<div className="toolboxBackdrop" onClick={()=>setToolsOpen(false)}><section className="toolbox" onClick={e=>e.stopPropagation()}><div className="toolboxTitle"><b>工具箱</b><div className="toolboxTitleActions"><button className={toolsEdit?"active":""} title="编辑工具箱" onClick={()=>{setToolsEdit(!toolsEdit);setIconPicker(null)}}>✎</button><button onClick={()=>setToolsOpen(false)}>×</button></div></div><div className="toolGrid"><button className="toolCard" onClick={()=>invoke("open_tool",{path:"builtin/项目任务工作台.html"}).catch(e=>setError(String(e)))}><span className="toolIcon builtinEmoji">✅</span><small>项目任务工作台</small></button><button className="toolCard" onClick={()=>{setToolsOpen(false);setCalendarOpen(true)}}><span className="toolIcon builtinEmoji">📅</span><small>工作/交易日历</small></button>{userTools.map((t,i)=><div className="toolCardWrap" key={t.path}><button className="toolCard" onClick={()=>{if(!toolsEdit)invoke("open_tool",{path:t.path}).catch(e=>setError(String(e)))}}><span className="toolIcon">{t.icon?.startsWith("data:image/")?<img src={t.icon} />:<span>{t.icon||"◉"}</span>}</span>{toolsEdit?<input className="toolNameInput" value={t.name} onChange={e=>{const next=userTools.map(x=>x.path===t.path?{...x,name:e.target.value}:x);setUserTools(next);localStorage.setItem("todo-tools",JSON.stringify(next))}} onClick={e=>e.stopPropagation()} />:<small>{t.name}</small>}</button>{toolsEdit&&<button className="toolIconEdit" title="选择图标" onClick={e=>{e.stopPropagation();setIconPicker(iconPicker===t.path?null:t.path)}}>✎</button>}{toolsEdit&&iconPicker===t.path&&<div className="iconPicker" onClick={e=>e.stopPropagation()}>{TOOL_ICONS.map(icon=><button key={icon} onClick={()=>{const next=userTools.map(x=>x.path===t.path?{...x,icon}:x);setUserTools(next);localStorage.setItem("todo-tools",JSON.stringify(next));setIconPicker(null)}}>{icon}</button>)}<label title="选择本地图片">＋<input type="file" accept="image/*" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)setToolIcon(t.path,f);e.currentTarget.value="";setIconPicker(null)}} /></label></div>}{toolsEdit&&<button className="toolRemove" title="删除快捷入口" onClick={()=>{const next=userTools.filter(x=>x.path!==t.path);setUserTools(next);localStorage.setItem("todo-tools",JSON.stringify(next))}}>×</button>}</div>)}<button className="toolCard addTool" onClick={()=>addTool(false)}><span>＋</span><small>添加文件/快捷方式</small></button><button className="toolCard addTool" onClick={()=>addTool(true)}><span>📁</span><small>添加文件夹</small></button></div></section></div>}{settings&&<section className="settings"><label><input type="checkbox" checked={startup} disabled={startupBusy} onChange={async e=>{const value=e.currentTarget.checked;const previous=startup;setStartup(value);setStartupBusy(true);try{await invoke("set_startup",{value});const actual=await invoke<boolean>("get_startup");setStartup(actual);if(actual!==value)setError("开机自启状态未成功更新，请重试");}catch(err){setStartup(previous);setError("开机自启设置失败："+err)}finally{setStartupBusy(false)}}}/> 开机启动</label><fieldset className="taskPlacementSettings" disabled={!prefsReady}><legend>新增任务位置</legend>{([1,2,3] as const).map(level=>{const key=("level"+level) as keyof TaskPlacement;return <label key={key}><span>{["一级任务","二级任务","三级任务"][level-1]}</span><select aria-label={["一级任务新增位置","二级任务新增位置","三级任务新增位置"][level-1]} value={taskPlacement[key]} onChange={e=>{const value=e.currentTarget.value==="top"?"top":"bottom";setTaskPlacement(p=>({...p,[key]:value}))}}><option value="top">顶部</option><option value="bottom">底部</option></select></label>})}<small>在所属分组或父任务内添加，也适用于重复任务。</small></fieldset><button onClick={test}>发送测试提醒</button><SyncSettings sync={sync}/></section>}{groupEditor&&<section className="groupManager"><div className="groupManagerHead"><b>任务分组</b><button onClick={()=>{setGroupEditor(false);setGroupForm({name:"",color:GROUP_COLORS[0]})}}>×</button></div><div className="groupForm"><input placeholder="分组名称" value={groupForm.name} onChange={e=>setGroupForm({...groupForm,name:e.target.value})}/><div className="colorChoices">{GROUP_COLORS.map(c=><button type="button" key={c} className={groupForm.color===c?"selected":""} style={{background:c}} onClick={()=>setGroupForm({...groupForm,color:c})}/>)}</div><button type="button" onClick={saveGroup}>{groupForm.id?"保存":"新建分组"}</button></div>{groups.map((g,index)=><div className="groupEditRow" key={g.id}><span className="groupDot" style={{background:g.color}}/><span className="groupEditName" title={g.name}>{g.name}</span><button className="groupMove" title="上移分组" aria-label={"上移分组："+g.name} disabled={index===0} onClick={()=>moveGroup(g.id,-1)}>↑</button><button className="groupMove" title="下移分组" aria-label={"下移分组："+g.name} disabled={index===groups.length-1} onClick={()=>moveGroup(g.id,1)}>↓</button><button onClick={()=>setGroupForm({id:g.id,name:g.name,color:g.color})}>编辑</button><button onClick={()=>deleteGroup(g.id)}>删除</button></div>)}{!groups.length&&<small>创建分组后，可在一级任务行中选择所属分组。</small>}</section>}<form onSubmit={e=>{e.preventDefault();if(text.trim()){setTasks(x=>insertTask(x,{...fresh(text.trim()),groupId:groups.some(g=>g.id===newGroupId)?newGroupId:""},taskPlacement.level1));setText("")}}}><input placeholder="添加一件要做的事…" value={text} disabled={!ready||!prefsReady} onKeyDown={e=>{if(e.key==="Tab"&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!e.nativeEvent.isComposing){e.preventDefault();if(text.trim())e.currentTarget.form?.requestSubmit();}}} onChange={e=>setText(e.target.value)}/>{groups.length>0&&<select className="newTaskGroup" value={newGroupId} onChange={e=>setNewGroupId(e.target.value)} title="新任务所属分组"><option value="">未分组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}<button disabled={!ready||!prefsReady||!text.trim()}>添加</button><button type="button" onClick={()=>setGroupEditor(!groupEditor)}>分组</button></form>{flatten(tasks).some(t=>isHolidayRepeat(t.repeat)&&!t.repeatArchived&&t.reminderAt&&(!hasHolidayYear(holidays.cache,new Date(t.reminderAt).getFullYear())||!hasHolidayYear(holidays.cache,new Date(clock).getFullYear())||t.repeatPending))&&<div className="holidayScheduleNotice">部分重复任务缺少所需年份的节假日数据，已暂停生成或提醒。请在工具箱日历中手动更新。</div>}<section className="list"><ul>{taskList(false)}</ul>{ready&&!tasks.some(t=>!t.done)&&<div className="empty">今天，先做好一件事。</div>}<section className="completed"><div className="completedHeader"><button className="completedTitle" onClick={()=>setCompletedOpen(!completedOpen)}>已完成</button>{flatten(tasks).some(t=>t.done)&&<button className="clearCompleted" onClick={()=>setClearConfirm(true)}>清理</button>}<button className="completedToggle" title={completedOpen?"折叠":"展开"} onClick={()=>setCompletedOpen(!completedOpen)}>{completedOpen?"−":"＋"}</button></div>{completedOpen&&<ul>{taskList(true)}</ul>}</section></section>{error&&<div className="error">{error}</div>}<footer><span>{flatten(tasks).filter(t=>t.done).length} / {flatten(tasks).length} 项任务完成</span><span className={"syncFooter"+(sync.footerError?" failed":"")} title={sync.footerTitle} aria-live="polite">{sync.footerText}</span></footer>{toast&&<div className="toast">{toast}</div>}{clearConfirm&&<div className="modalBackdrop"><div className="modal"><h2>清理已完成任务</h2><p>确定删除全部已完成任务及其子任务吗？</p><div className="modalActions"><button onClick={()=>setClearConfirm(false)}>取消</button><button className="danger" onClick={()=>{setTasks(removeDone);setClearConfirm(false)}}>确定清理</button></div></div></div>}{pending&&<div className="modalBackdrop"><div className="modal"><h2>删除任务</h2><p>删除“{pending.text}”及其所有子任务？</p><div className="modalActions"><button onClick={()=>setPending(null)}>取消</button><button className="danger" onClick={()=>{setTasks(x=>remove(x,pending.id));setPending(null)}}>确定删除</button></div></div></div>}</main><SyncConflictDialog sync={sync}/>{syncApplying&&<div className="modalBackdrop syncConflictBackdrop"><div className="modal">正在保存同步数据…</div></div>}{syncFatal&&<div className="modalBackdrop syncConflictBackdrop"><section className="modal"><p>本地同步写入未完成。备份已保留，可重新读取或重启软件完成恢复。</p><button onClick={()=>void restoreDisk().catch(()=>setError("恢复仍未完成，请检查磁盘空间后重启软件"))}>重新读取本地数据</button></section></div>}</>}
createRoot(document.getElementById("root")!).render(location.pathname.endsWith("calendar.html")||location.search.includes("calendar")?<CalendarPage/>:<App/>);
















