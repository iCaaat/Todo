import type {ListStyle} from "./taskNumbering";
import {DEFAULT_PLACEMENT,TaskPlacement,positionAt} from "./taskPlacement";
import {BUILTIN_HOLIDAYS,HolidayCache,isHolidayRepeat,matchesHoliday,nextHolidayDate} from "./holidays";
export type Repeat = "" | "daily" | "weekly" | "monthly" | "yearly" | "workday" | "holiday";
export type Task = {
  id:string;text:string;done:boolean;collapsed:boolean;children:Task[];
  reminder?:string;reminderAt?:string;remindedAt?:string;repeat?:Repeat;groupId?:string;childListStyle?:ListStyle;
  repeatSeries?:string;repeatAnchor?:string;repeatIndex?:number;repeatArchived?:boolean;repeatPending?:boolean;
};
const cycles = new Set(["daily","weekly","monthly","yearly","workday","holiday"]);
const pad=(n:number)=>String(n).padStart(2,"0");
export const localReminder=(d:Date)=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
export function occurrenceAt(anchor:Date, repeat:Repeat, index:number):Date {
  const d=new Date(anchor);
  if(repeat==="daily"||repeat==="weekly"||isHolidayRepeat(repeat))d.setDate(anchor.getDate()+index*(repeat==="weekly"?7:1));
  else {
    d.setDate(1);
    if(repeat==="monthly")d.setMonth(anchor.getMonth()+index);
    else d.setFullYear(anchor.getFullYear()+index);
    const end=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
    d.setDate(Math.min(anchor.getDate(),end));
  }
  return d;
}
export function resetRepeat(task:Task):Task {
  const {repeatSeries,repeatAnchor,repeatIndex,repeatArchived,repeatPending,...rest}=task;
  return rest;
}
// Align a newly configured holiday series before its first notification is saved.
// Missing annual data suspends it; a later cache update resumes it automatically.
export function alignHolidayTask(task:Task,cache:HolidayCache):Task {
  if(!isHolidayRepeat(task.repeat)||task.repeatArchived||task.repeatSeries||!task.reminderAt)return task;
  const date=new Date(task.reminderAt);if(!Number.isFinite(date.getTime()))return task;
  const next=nextHolidayDate(date,task.repeat,cache);
  if(!next)return task.repeatPending?task:{...task,repeatPending:true};
  if(next.getTime()===date.getTime()&&!task.repeatPending)return task;
  return {...task,repeatPending:false,reminderAt:next.toISOString(),reminder:localReminder(next),remindedAt:""};
}
// A new occurrence appears at midnight on its scheduled date, independently of completion.
export function expandRecurringTasks(tasks:Task[], now:number, placement:TaskPlacement=DEFAULT_PLACEMENT,cache:HolidayCache=BUILTIN_HOLIDAYS):Task[] {
  const today=new Date(now);today.setHours(0,0,0,0);
  function visit(items:Task[],depth:number):Task[] {
    let changed=false;
    const output:Task[]=[],additions:Task[]=[];
    for(const original of items) {
      const children=visit(original.children||[],depth+1);
      if(children!==original.children)changed=true;
      let task=children===original.children?original:{...original,children};
      if(task.repeatArchived || !cycles.has(task.repeat||"") || !task.reminderAt) {output.push(task);continue;}
      const aligned=alignHolidayTask(task,cache);if(aligned!==task){task=aligned;changed=true;}
      if(task.repeatPending){output.push(task);continue;}
      const anchor=new Date(task.repeatAnchor||task.reminderAt||"");
      if(!Number.isFinite(anchor.getTime())) {output.push(task);continue;}
      const series=task.repeatSeries||task.id;
      let index=task.repeatIndex||0;
      let generated=0;
      while(generated<366) {
        let nextIndex=index+1,next=occurrenceAt(anchor,task.repeat||"",nextIndex);
        if(isHolidayRepeat(task.repeat)){
          // Index counts calendar days, so changing holiday data never reuses an ID.
          let matched=false;
          for(let scanned=0;scanned<3660;scanned++){
            const start=new Date(next);start.setHours(0,0,0,0);
            if(start.getTime()>today.getTime())break;
            const eligible=matchesHoliday(next,task.repeat,cache);
            if(eligible===null)break;
            if(eligible){matched=true;break;}
            next=occurrenceAt(anchor,task.repeat,++nextIndex);
          }
          if(!matched)break;
        }
        const start=new Date(next);start.setHours(0,0,0,0);
        if(start.getTime()>today.getTime())break;
        changed=true;
        (generated===0?output:additions).push({...task,repeatArchived:true});
        const oldTime=new Date(task.reminderAt||"").getTime();
        const dayShift=Math.round((Date.UTC(next.getFullYear(),next.getMonth(),next.getDate())-Date.UTC(new Date(oldTime).getFullYear(),new Date(oldTime).getMonth(),new Date(oldTime).getDate()))/86400000);
        const cloneChild=(child:Task,path:string):Task=>{
          const copy=resetRepeat(child);
          const parsed=child.reminderAt?new Date(child.reminderAt):null;
          const date=parsed&&Number.isFinite(parsed.getTime())?parsed:null;
          if(date&&Number.isFinite(date.getTime()))date.setDate(date.getDate()+dayShift);
          return {...copy,id:series+":cycle:"+nextIndex+":"+path,done:false,remindedAt:"",repeat:"",
            reminderAt:date?.toISOString()||"",reminder:date?localReminder(date):"",
            children:(child.children||[]).map((c,i)=>cloneChild(c,path+"."+i))};
        };
        task={...task,id:series+":cycle:"+nextIndex,done:false,remindedAt:"",
          reminderAt:next.toISOString(),reminder:localReminder(next),repeatSeries:series,
          repeatAnchor:anchor.toISOString(),repeatIndex:nextIndex,repeatArchived:false,
          children:task.children.map((c,i)=>cloneChild(c,String(i)))};
        index=nextIndex;generated++;
      }
      (generated?additions:output).push(task);
    }
    if(!changed)return items;
    return positionAt(placement,depth)==="top"?[...additions.reverse(),...output]:[...output,...additions];
  }
  return visit(tasks,1);
}

