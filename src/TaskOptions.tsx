import React,{useEffect,useLayoutEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Task,Repeat,localReminder} from "./recurrence";
import {LIST_STYLES,ListStyle} from "./taskNumbering";
type Props={task:Task;rootTask:boolean;allowList:boolean;groups:{id:string;name:string}[];anchor:HTMLElement;
 onListStyle:(style:ListStyle)=>void;onGroup:(id:string)=>void;onReminder:(value:string)=>void;onRepeat:(value:Repeat)=>void;onClose:()=>void};
export function TaskOptions({task,rootTask,allowList,groups,anchor,onListStyle,onGroup,onReminder,onRepeat,onClose}:Props) {
 const panel=useRef<HTMLDivElement>(null),dateInput=useRef<HTMLInputElement>(null);
 const [time,setTime]=useState(()=>task.reminderAt?localReminder(new Date(task.reminderAt)):task.reminder||"");
 const dirty=useRef(false),[error,setError]=useState("");
 const [position,setPosition]=useState({left:8,top:8});
 const finish=()=>{
   if(dirty.current) {
     if(!dateInput.current?.validity.valid || (time&&!Number.isFinite(new Date(time).getTime()))) {setError("请填写完整的日期和时间");return false;}
     onReminder(time);dirty.current=false;
   }
   onClose();return true;
 };
 const latest=useRef({finish,onClose});latest.current={finish,onClose};
 useEffect(()=>{
   const outside=(e:PointerEvent)=>{const node=e.target as Node;if(!panel.current?.contains(node)&&!anchor.contains(node))latest.current.finish();};
   const escape=(e:KeyboardEvent)=>{if(e.key==="Escape")latest.current.onClose();};
   document.addEventListener("pointerdown",outside,true);document.addEventListener("keydown",escape);
   return()=>{document.removeEventListener("pointerdown",outside,true);document.removeEventListener("keydown",escape);};
 },[anchor]);
 useLayoutEffect(()=>{
   const place=()=>{
     const rect=anchor.getBoundingClientRect(),box=panel.current;if(!box)return;
     const left=Math.max(8,Math.min(rect.right-box.offsetWidth,innerWidth-box.offsetWidth-8));
     const top=rect.bottom+6+box.offsetHeight<=innerHeight-8?rect.bottom+6:Math.max(8,rect.top-box.offsetHeight-6);
     setPosition({left,top});
   };
   place();window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
   return()=>{window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};
 },[anchor]);
 return createPortal(<div ref={panel} role="dialog" aria-label="任务选项" className="taskOptions taskOptionsFloating" style={position}>
   <div className="taskOptionsHeading"><b>任务选项</b><button type="button" aria-label="关闭任务选项" onClick={()=>finish()}>×</button></div>
   {rootTask&&<label>所属分组<select value={task.groupId||""} onChange={e=>{const value=e.target.value;if(finish())onGroup(value);}}>
     <option value="">未分组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
   </select></label>}
   {allowList&&<label>启用列表<select aria-label="启用列表" value={task.childListStyle||""} onChange={e=>{const value=e.currentTarget.value as ListStyle;if(finish())onListStyle(value);}}>
     {LIST_STYLES.map(style=><option key={style.value} value={style.value}>{style.label}</option>)}
   </select></label>}
   <label>提醒时间<input ref={dateInput} type="datetime-local" value={time} onChange={e=>{setTime(e.target.value);dirty.current=true;setError("");}} onKeyDown={e=>{if(e.key==="Enter")finish();}}/></label>
   <label>重复<select value={task.repeatArchived?"":task.repeat||""} onChange={e=>{const value=e.target.value as Repeat;if(finish())onRepeat(value);}}>
     <option value="">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option>
   </select></label>
   {task.repeat&&!task.repeatArchived&&<small>下一周期自动新增任务，保留本次记录。</small>}
   {error&&<p role="alert" className="taskOptionsError">{error}</p>}
   <div className="taskOptionsActions">{(time||task.reminderAt)&&<button type="button" onClick={()=>{onReminder("");onClose();}}>清除提醒</button>}<button type="button" className="active" onClick={()=>finish()}>完成</button></div>
 </div>,document.body);
}

