import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {BUILTIN_HOLIDAYS,HolidayCache,fetchHolidayYear,mergeHolidayCache} from "./holidays";

export function useHolidays(){
  const [cache,setCache]=useState<HolidayCache>(BUILTIN_HOLIDAYS),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const cacheRef=useRef(cache),updating=useRef(false);
  useEffect(()=>{let active=true;invoke<unknown>("load_holidays").then(value=>{if(active){const next=mergeHolidayCache(value);cacheRef.current=next;setCache(next);}}).catch(error=>{if(active)setMessage("读取节假日缓存失败，已使用内置数据："+String(error));}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  const update=async(year:number)=>{
    if(!ready||updating.current)return;
    updating.current=true;setBusy(true);setMessage("正在更新节假日数据，可继续操作或关闭日历…");
    try{
      const years=[year-1,year,year+1];
      const results=await Promise.allSettled(years.map(fetchHolidayYear));
      const next={...cacheRef.current},updated:number[]=[],pending:number[]=[],failed:string[]=[];
      results.forEach((result,i)=>{
        if(result.status==="rejected")failed.push(`${years[i]} 年：${String(result.reason?.message||result.reason)}`);
        else if(!result.value)pending.push(years[i]);
        else{next[years[i]]=result.value;updated.push(years[i]);}
      });
      // Persist first: reporting success means the same data is available after restart.
      if(updated.length){await invoke("save_holidays",{data:next});cacheRef.current=next;setCache(next);}
      setMessage([updated.length?`已更新 ${updated.join("、")} 年并保存到本地。`:"未取得新数据，保留原缓存。",pending.length?`${pending.join("、")} 年安排尚未公布。`:"",failed.length?`更新失败，保留原缓存（${failed.join("；")}）。`:""].filter(Boolean).join(" "));
    }catch(error){setMessage("更新未保存，继续使用原缓存："+String(error));}
    finally{updating.current=false;setBusy(false);}
  };
  return {cache,ready,busy,message,update};
}
