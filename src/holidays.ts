import year2025 from "./data/holidays-2025.json";
import year2026 from "./data/holidays-2026.json";

export type HolidayDay={name:string;date:string;isOffDay:boolean};
export type HolidayYear={year:number;papers:string[];days:HolidayDay[];updatedAt?:string};
export type HolidayCache=Record<string,HolidayYear>;
export type DayInfo={known:boolean;work:boolean;holiday:boolean;name:string;makeup:boolean};
export const BUILTIN_HOLIDAYS:HolidayCache={2025:year2025,2026:year2026};
const pad=(n:number)=>String(n).padStart(2,"0");
export const dateKey=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export function parseHolidayYear(value:unknown,year:number):HolidayYear {
  const v=value as HolidayYear;
  if(!v||v.year!==year||!Array.isArray(v.papers)||!v.papers.every(x=>typeof x==="string")||!Array.isArray(v.days)||v.days.length>400)throw new Error("节假日数据格式无效");
  const seen=new Set<string>();
  for(const d of v.days){
    if(!d||typeof d.name!=="string"||!d.name.trim()||typeof d.isOffDay!=="boolean"||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||dateKey(new Date(d.date+"T12:00:00"))!==d.date||Math.abs(Number(d.date.slice(0,4))-year)>1||seen.has(d.date))throw new Error("节假日日期格式无效");
    seen.add(d.date);
  }
  return {year,papers:[...v.papers],days:v.days.map(({name,date,isOffDay})=>({name,date,isOffDay})),...(typeof v.updatedAt==="string"?{updatedAt:v.updatedAt}:{})};
}
export const hasHolidayYear=(cache:HolidayCache,year:number)=>!!cache[year]?.papers.length&&!!cache[year]?.days.length;
export function mergeHolidayCache(value:unknown):HolidayCache {
  const result={...BUILTIN_HOLIDAYS};
  if(value&&typeof value==="object"&&!Array.isArray(value))for(const [key,v] of Object.entries(value)){
    try{const parsed=parseHolidayYear(v,Number(key));if(parsed.papers.length&&parsed.days.length)result[key]=parsed;}catch{/* Ignore corrupt cached years, preserving bundled data. */}
  }
  return result;
}
export function dayInfo(date:Date,cache:HolidayCache):DayInfo {
  const year=date.getFullYear(),key=dateKey(date),week=date.getDay();
  // A following year's announcement may override dates in December of this year.
  let entry:HolidayDay|undefined;
  for(const y of [year-1,year,year+1])entry=cache[y]?.days.find(d=>d.date===key)||entry;
  const known=hasHolidayYear(cache,year)||!!entry;
  return {known,work:entry?!entry.isOffDay:week!==0&&week!==6,holiday:entry?.isOffDay===true,name:entry?.name||"",makeup:entry?.isOffDay===false};
}
export type HolidayRepeat="workday"|"holiday";
export const isHolidayRepeat=(value:unknown):value is HolidayRepeat=>value==="workday"||value==="holiday";
export function matchesHoliday(date:Date,repeat:HolidayRepeat,cache:HolidayCache):boolean|null {
  const info=dayInfo(date,cache);
  return info.known?(repeat==="workday"?info.work:info.holiday):null;
}
export function nextHolidayDate(date:Date,repeat:HolidayRepeat,cache:HolidayCache):Date|null {
  const candidate=new Date(date);
  for(let i=0;i<3660;i++){
    const matches=matchesHoliday(candidate,repeat,cache);
    if(matches===null)return null;
    if(matches)return candidate;
    candidate.setDate(candidate.getDate()+1);
  }
  return null;
}
export async function fetchHolidayYear(year:number):Promise<HolidayYear|null> {
  const urls=[
    `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
    `https://api.github.com/repos/NateScarlet/holiday-cn/contents/${year}.json`
  ];
  let lastError="网络不可用",notFound=0;
  for(const url of urls){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
    try{
      const response=await fetch(url,{signal:controller.signal,cache:"no-store"});
      if(response.status===404){notFound++;continue;}
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const text=await response.text();if(text.length>512000)throw new Error("数据文件过大");
      let value=JSON.parse(text);
      if(url.includes("api.github.com")){
        if(value.encoding!=="base64"||typeof value.content!=="string")throw new Error("数据下载格式无效");
        value=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.content.replace(/\s/g,"")),c=>c.charCodeAt(0))));
      }
      const parsed=parseHolidayYear(value,year);
      if(!parsed.papers.length||!parsed.days.length)return null;
      return {...parsed,updatedAt:new Date().toISOString()};
    }catch(error){const problem=error as {name?:string;message?:string}|null;lastError=problem?.name==="AbortError"?"连接超时":problem?.message||String(error);}
    finally{clearTimeout(timer);}
  }
  if(notFound===urls.length)return null;
  throw new Error(lastError);
}
