import {useEffect,useRef,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {Checkpoint,DEFAULT_SYNC_CONFIG,RemoteSnapshot,SyncChoice,SyncClient,SyncConfig,SyncConflict,SyncData,profileKey} from "./sync";

type Local={ready:boolean;signature:string;read:()=>SyncData;apply:(data:SyncData,expected:SyncData,checkpoint:Checkpoint)=>Promise<void>};
type Phase="idle"|"syncing"|"testing"|"synced"|"error";
export function useSync(local:Local){
  const latest=useRef(local);latest.current=local;
  const client=useRef<SyncClient|null>(null),working=useRef(false),retryAfter=useRef(0),nextSyncAt=useRef(0);
  const [config,setConfig]=useState<SyncConfig>(DEFAULT_SYNC_CONFIG),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState("未配置，当前仅本地保存"),[phase,setPhase]=useState<Phase>("idle"),[lastSyncAt,setLastSyncAt]=useState(""),[conflict,setConflict]=useState<SyncConflict|null>(null),[dialogOpen,setDialogOpen]=useState(false);
  const [scheduleEpoch,setScheduleEpoch]=useState(0);
  const makeClient=(cfg:SyncConfig,checkpoint:unknown)=>new SyncClient(cfg,{
    readLocal:()=>latest.current.read(),request:(method,body)=>invoke("sync_http",{profile:profileKey(cfg),method,body:body??null}),
    saveCheckpoint:checkpoint=>invoke("sync_save_checkpoint",{checkpoint}),
    applyRemote:(data,expected,checkpoint)=>latest.current.apply(data,expected,checkpoint),
    backup:(remote:RemoteSnapshot)=>invoke("sync_backup",{remote})
  },checkpoint);
  useEffect(()=>{let active=true;(async()=>{
    try{
      const cfg=await invoke<SyncConfig|null>("sync_load_config");const saved={...DEFAULT_SYNC_CONFIG,...cfg};
      const checkpoint=await invoke<unknown>("sync_load_checkpoint");if(!active)return;
      const engine=makeClient(saved,checkpoint);client.current=engine;setConfig(saved);setLastSyncAt(engine.checkpoint?.lastSyncAt||"");
      if(saved.server)setStatus(saved.enabled?"等待同步":"已配置，自动同步已关闭");
    }catch{if(active){setStatus("同步配置读取失败，当前仅本地保存");setPhase("error");}}
    finally{if(active)setLoaded(true);}
  })();return()=>{active=false;};},[]);
  const save=async(draft:SyncConfig,token:string,clearToken:boolean)=>{
    if(working.current)return false;
    if(!Number.isInteger(draft.syncIntervalMinutes)||draft.syncIntervalMinutes<1||draft.syncIntervalMinutes>1440){setStatus("同步间隔须为 1–1440 分钟的整数");setPhase("error");return false;}
    working.current=true;setBusy(true);
    try{
      const cfg=await invoke<SyncConfig>("sync_save_config",{config:{server:draft.server,userId:draft.userId,enabled:draft.enabled,allowHttp:draft.allowHttp,syncIntervalMinutes:draft.syncIntervalMinutes,syncOnEdit:draft.syncOnEdit},token:token||null,clearToken});
      const cp=await invoke<unknown>("sync_load_checkpoint");client.current=makeClient(cfg,cp);setConfig(cfg);setLastSyncAt(client.current.checkpoint?.lastSyncAt||"");setConflict(null);setDialogOpen(false);retryAfter.current=0;nextSyncAt.current=0;setPhase("idle");
      setStatus(cfg.enabled?"配置已保存，等待同步":"配置已保存，自动同步已关闭");return true;
    }catch(error){setStatus(String(error));setPhase("error");return false;}
    finally{working.current=false;setBusy(false);setScheduleEpoch(n=>n+1);}
  };
  const run=async(choice?:SyncChoice,automatic=false)=>{
    const engine=client.current;if(!engine||working.current||!latest.current.ready||!engine.config.server||!engine.config.hasToken)return;
    if(automatic&&(engine.conflict||Date.now()<retryAfter.current))return;
    working.current=true;setBusy(true);setPhase("syncing");setStatus("正在同步，可继续编辑本机任务…");
    try{
      const result=await engine.run(choice);setStatus(result.message);setConflict(result.conflict||null);setLastSyncAt(engine.checkpoint?.lastSyncAt||"");
      if(result.conflict)setDialogOpen(true);
      retryAfter.current=0;nextSyncAt.current=Date.now()+engine.config.syncIntervalMinutes*60000;setPhase("synced");
    }catch(error){setStatus("同步未完成："+String(error));setPhase("error");retryAfter.current=Date.now()+60000;nextSyncAt.current=retryAfter.current;}
    finally{working.current=false;setBusy(false);setScheduleEpoch(n=>n+1);}
  };
  const test=async()=>{
    const engine=client.current;if(!engine||working.current||!engine.config.server||!engine.config.hasToken)return;
    working.current=true;setBusy(true);setPhase("testing");setStatus("正在测试连接…");
    try{setStatus(await engine.test());setPhase("idle");}catch(error){setStatus("连接失败："+String(error));setPhase("error");}
    finally{working.current=false;setBusy(false);setScheduleEpoch(n=>n+1);}
  };
  const actions=useRef({run});actions.current={run};
  // One deadline survives re-renders and temporary readiness changes during a download.
  // Startup/enable has deadline 0; every successful sync restarts the idle interval.
  useEffect(()=>{
    if(!loaded||!config.enabled||!config.server||!config.hasToken||!local.ready||busy||conflict)return;
    const due=()=>Math.max(nextSyncAt.current,retryAfter.current);
    const timer=window.setTimeout(()=>void actions.current.run(undefined,true),Math.max(0,due()-Date.now()));
    const wake=()=>{if(document.visibilityState==="visible"&&Date.now()>=due())void actions.current.run(undefined,true);};
    window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);
    return()=>{clearTimeout(timer);window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);};
  },[loaded,config,local.ready,busy,conflict,scheduleEpoch]);
  useEffect(()=>{
    if(!loaded||!config.enabled||!config.syncOnEdit||!config.server||!config.hasToken||!local.ready||busy||conflict||!client.current?.dirty)return;
    const timer=window.setTimeout(()=>void actions.current.run(undefined,true),Math.max(3000,retryAfter.current-Date.now()));
    return()=>clearTimeout(timer);
  },[loaded,config,local.ready,local.signature,busy,conflict,scheduleEpoch]);
  const dirty=client.current?.dirty??true;
  const footerText=!config.server?"本地自动保存":phase==="syncing"?"云同步中…":phase==="testing"?"测试连接中…":phase==="error"?"云同步失败":conflict?"云同步待确认":!config.hasToken?"等待配置云同步":!config.enabled?"自动同步已关闭":dirty?"等待云同步":"云端已同步";
  const footerTitle=config.server?[status,lastSyncAt?"上次同步："+new Date(lastSyncAt).toLocaleString():"尚未完成同步"].join("\n"):status;
  return {config,loaded,busy,status,lastSyncAt,conflict,dialogOpen,save,run,test,footerText,footerTitle,footerError:phase==="error",openConflict:()=>setDialogOpen(true),closeConflict:()=>setDialogOpen(false)};
}
export type SyncController=ReturnType<typeof useSync>;
