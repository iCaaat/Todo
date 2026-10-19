import React,{useState} from "react";
import {HolidayCache,dateKey,dayInfo,hasHolidayYear} from "./holidays";
import {useHolidays} from "./useHolidays";

type Props={cache:HolidayCache;ready:boolean;busy:boolean;message:string;update:(year:number)=>Promise<void>};
export function WorkCalendar({cache,ready,busy,message,update}:Props){
  const [date,setDate]=useState(()=>new Date()),year=date.getFullYear(),month=date.getMonth();
  const first=new Date(year,month,1).getDay(),last=new Date(year,month+1,0).getDate(),known=hasHolidayYear(cache,year);
  return <section className="workCalendar" aria-label="工作日历">
    <div className="calendarNavigation"><button aria-label="上个月" onClick={()=>setDate(new Date(year,month-1,1))}>‹</button><b>{year}年{month+1}月</b><button aria-label="下个月" onClick={()=>setDate(new Date(year,month+1,1))}>›</button><button onClick={()=>setDate(new Date())}>今天</button></div>
    <div className="calendarToolbar"><span>工作日历</span><button disabled title="A股交易日历待实现">A股交易日历（待实现）</button><button disabled={!ready||busy} onClick={()=>void update(year)}>{busy?"更新中…":"手动更新"}</button></div>
    <div className="calendarLegend"><span>休：放假</span><span>班：调休补班</span></div>
    {!known&&<p className="calendarNotice">{year} 年节假日数据缺失或尚未公布；仅显示普通周末参考，请手动更新。该年度节假日重复任务暂停生成。</p>}
    <div className="workCalendarGrid">
      {["日","一","二","三","四","五","六"].map(x=><small key={x}>{x}</small>)}
      {Array.from({length:first},(_,i)=><i key={"empty"+i}/>)}
      {Array.from({length:last},(_,i)=>{
        const day=new Date(year,month,i+1),info=dayInfo(day,cache),key=dateKey(day);
        const label=info.known?(info.holiday?info.name:info.makeup?"调休补班":info.work?"工作日":"周末"):"待更新";
        return <div key={key} data-date={key} title={`${key} ${label}${info.makeup?" · "+info.name:""}`} className={"calendarDay "+(info.known?(info.holiday?"holiday":info.makeup?"makeup":info.work?"work":"rest"):"unknown")+(day.toDateString()===new Date().toDateString()?" today":"")}>
          <div><b>{i+1}</b>{info.known&&(info.holiday||info.makeup)&&<small>{info.holiday?"休":"班"}</small>}</div><em>{label}</em>
        </div>;
      })}
    </div>
    <p className="calendarStatus" role="status">{message||(!ready?"正在读取本地缓存…":cache[year]?.updatedAt?`缓存更新于 ${new Date(cache[year].updatedAt!).toLocaleString()}`:known?`使用内置 ${year} 年节假日数据，可离线使用。`:"可点击手动更新获取已公布的年度安排。")}</p>
    <p className="calendarSource">来源：<a href="https://github.com/NateScarlet/holiday-cn" target="_blank" rel="noreferrer">holiday-cn</a> · 国务院放假安排 · MIT。节假日以数据标注的放假日期为准；部分与周末连休的普通周末不会单独标注。</p>
  </section>;
}
export function CalendarPage(){const holidays=useHolidays();return <main><WorkCalendar {...holidays}/></main>;}
