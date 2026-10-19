import type {Task} from "./recurrence";
import {LIST_STYLES} from "./taskNumbering";
import {normalizePlacement,TaskPlacement} from "./taskPlacement";

export type SyncGroup={id:string;name:string;color:string;collapsed?:boolean};
export type SyncData={tasks:Task[];groups:SyncGroup[];taskPlacement:TaskPlacement};
export type SyncConfig={server:string;userId:string;enabled:boolean;allowHttp:boolean;hasToken:boolean;syncIntervalMinutes:number;syncOnEdit:boolean};
export const DEFAULT_SYNC_CONFIG:SyncConfig={server:"",userId:"default",enabled:false,allowHttp:false,hasToken:false,syncIntervalMinutes:15,syncOnEdit:true};
export type RemoteSnapshot={schemaVersion:1;serverId:string;userId:string;revision:number;updatedAt:string|null;data:SyncData|null};
export type Checkpoint={profile:string;serverId:string;userId:string;revision:number;data:SyncData;lastSyncAt:string};
export type SyncChoice="local"|"remote";
export type SyncConflict={reason:string;remote:RemoteSnapshot;local:SyncData};
export type SyncResult={message:string;conflict?:SyncConflict};
export const profileKey=(config:SyncConfig)=>JSON.stringify([config.server,config.userId]);
const taskFields=["reminder","reminderAt","repeat","childListStyle","repeatSeries","repeatAnchor","repeatIndex","repeatArchived"] as const;
const repeats=new Set(["","daily","weekly","monthly","yearly","workday","holiday"]);
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function text(v:unknown,max=64000):v is string{return typeof v==="string"&&v.length<=max;}
export function syncData(tasks:Task[],groups:SyncGroup[],placement:TaskPlacement):SyncData {
  const copy=(t:Task):Task=>{
    const result:Task={id:t.id,text:t.text,done:t.done,collapsed:!!t.collapsed,groupId:t.groupId||"",children:t.children.map(copy)};
    for(const field of taskFields)if(t[field]!==undefined)(result as any)[field]=t[field];
    return result;
  };
  return {tasks:tasks.map(copy),groups:groups.map(g=>({id:g.id,name:g.name,color:g.color,collapsed:!!g.collapsed})),taskPlacement:normalizePlacement(placement)};
}
export const fingerprint=(value:SyncData)=>JSON.stringify(syncData(value.tasks,value.groups,value.taskPlacement));
export function validateData(value:unknown,source:"云端"|"本机"="云端"):SyncData {
  const invalid=(message:string)=>new Error(source+message);
  if(!plain(value)||!Array.isArray(value.tasks)||!Array.isArray(value.groups)||!plain(value.taskPlacement))throw invalid("数据结构无效，未修改本机数据");
  const groups=new Set<string>(),ids=new Set<string>();let count=0;
  if(value.groups.length>1000)throw invalid("分组数量超出限制");
  for(const g of value.groups){if(!plain(g)||!text(g.id,512)||!g.id||groups.has(g.id)||!text(g.name)||!text(g.color,7)||!/^#[0-9a-f]{6}$/i.test(g.color)||(g.collapsed!==undefined&&typeof g.collapsed!=="boolean"))throw invalid("分组格式无效");groups.add(g.id);}
  const visit=(items:unknown[],depth:number)=>{for(const t of items){
    if(++count>10000||depth>3||!plain(t)||!text(t.id,1024)||!t.id||ids.has(t.id)||!text(t.text)||typeof t.done!=="boolean"||typeof t.collapsed!=="boolean"||!Array.isArray(t.children))throw invalid("任务格式、层级或 ID 无效");
    ids.add(t.id);
    if(t.groupId!==undefined&&(!text(t.groupId,512)||(t.groupId!==""&&!groups.has(t.groupId))))throw invalid("任务引用了不存在的分组");
    for(const field of ["reminder","reminderAt","repeatAnchor","repeatSeries"] as const)if(t[field]!==undefined&&!text(t[field],1024))throw invalid("提醒格式无效");
    for(const field of ["reminderAt","repeatAnchor"] as const)if(t[field]&&!Number.isFinite(Date.parse(t[field] as string)))throw invalid("提醒日期无效");
    if(t.repeat!==undefined&&!repeats.has(t.repeat as string))throw invalid("重复方式不受支持");
    if(t.childListStyle!==undefined&&!LIST_STYLES.some(s=>s.value===t.childListStyle))throw invalid("列表样式不受支持");
    if(t.repeatIndex!==undefined&&(!Number.isSafeInteger(t.repeatIndex)||(t.repeatIndex as number)<0))throw invalid("重复序号无效");
    if(t.repeatArchived!==undefined&&typeof t.repeatArchived!=="boolean")throw invalid("重复状态无效");
    visit(t.children,depth+1);
  }};visit(value.tasks,1);
  for(const level of ["level1","level2","level3"])if(!["top","bottom"].includes(value.taskPlacement[level] as string))throw invalid("新增位置设置无效");
  const result=syncData(value.tasks as Task[],value.groups as SyncGroup[],value.taskPlacement as TaskPlacement);
  if(JSON.stringify(result).length>4000000)throw new Error("同步数据超过 4 MB 限制");
  return result;
}
export function validateRemote(value:unknown,config:SyncConfig):RemoteSnapshot {
  if(!plain(value)||value.schemaVersion!==1||!text(value.serverId,256)||!value.serverId||value.userId!==config.userId||!Number.isSafeInteger(value.revision)||(value.revision as number)<0||(value.updatedAt!==null&&(!text(value.updatedAt,128)||!Number.isFinite(Date.parse(value.updatedAt)))))throw new Error("服务器协议或用户身份不匹配，未修改任何任务");
  if(value.data===null&&value.revision!==0)throw new Error("服务器空数据版本无效");
  return {schemaVersion:1,serverId:value.serverId,userId:value.userId,revision:value.revision as number,updatedAt:value.updatedAt as string|null,data:value.data===null?null:validateData(value.data)};
}
export type SyncIO={
  readLocal:()=>SyncData;
  request:(method:"GET"|"PUT",body?:unknown)=>Promise<{status:number;body:unknown}>;
  saveCheckpoint:(checkpoint:Checkpoint)=>Promise<void>;
  applyRemote:(data:SyncData,expected:SyncData,checkpoint:Checkpoint)=>Promise<void>;
  backup:(remote:RemoteSnapshot)=>Promise<void>;
};
function checkStatus(status:number){
  if(status===401||status===403)throw new Error("认证失败，请检查用户 ID、访问令牌及账户权限");
  if(status>=300&&status<400)throw new Error("同步地址发生重定向，请填写最终服务器地址");
  if(status!==200)throw new Error(`同步请求失败（HTTP ${status}），本机数据已保留`);
}
export class SyncClient {
  checkpoint:Checkpoint|null;
  conflict:SyncConflict|null=null;
  constructor(readonly config:SyncConfig,readonly io:SyncIO,checkpoint:unknown){
    this.checkpoint=null;
    if(plain(checkpoint)&&checkpoint.profile===profileKey(config)&&checkpoint.userId===config.userId&&text(checkpoint.serverId,256)&&Number.isSafeInteger(checkpoint.revision)&&typeof checkpoint.lastSyncAt==="string"){
      try{this.checkpoint={...checkpoint,data:validateData(checkpoint.data)} as Checkpoint;}catch{/* A bad checkpoint requires a fresh direction choice. */}
    }
  }
  get dirty(){return !this.checkpoint||fingerprint(this.io.readLocal())!==fingerprint(this.checkpoint.data);}
  async fetchRemote(){const result=await this.io.request("GET");checkStatus(result.status);return validateRemote(result.body,this.config);}
  async test(){const remote=await this.fetchRemote();return `连接成功：用户 ${remote.userId}，云端版本 ${remote.revision}。测试未修改本机或云端数据。`;}
  private needsChoice(reason:string,remote:RemoteSnapshot,local:SyncData):SyncResult {
    this.conflict={reason,remote,local};return {message:reason,conflict:this.conflict};
  }
  private nextCheckpoint(remote:RemoteSnapshot,data:SyncData):Checkpoint{return {profile:profileKey(this.config),serverId:remote.serverId,userId:remote.userId,revision:remote.revision,data,lastSyncAt:new Date().toISOString()};}
  async run(choice?:SyncChoice):Promise<SyncResult>{
    const previous=this.conflict,remote=await this.fetchRemote(),local=validateData(this.io.readLocal(),"本机"),cp=this.checkpoint;
    if(choice&&(!previous||previous.remote.serverId!==remote.serverId||previous.remote.revision!==remote.revision||JSON.stringify(previous.remote.data)!==JSON.stringify(remote.data)||fingerprint(previous.local)!==fingerprint(local)))return this.needsChoice("本机或云端数据已变化，请重新确认同步方向。",remote,local);
    let action:SyncChoice|"equal";
    if(choice)action=choice;
    else if(!cp)return this.needsChoice("首次连接或切换账户，请选择同步方向。",remote,local);
    else if(cp.serverId!==remote.serverId||remote.revision<cp.revision||!remote.data)return this.needsChoice("服务器身份、版本或数据已重置，请选择同步方向。",remote,local);
    else {
      const localKey=fingerprint(local),remoteKey=fingerprint(remote.data),baseKey=fingerprint(cp.data);
      if(remote.revision===cp.revision&&remoteKey!==baseKey)throw new Error("服务器在未递增版本号时修改了数据，已停止同步");
      if(localKey===remoteKey)action="equal";
      else if(localKey!==baseKey&&remote.revision!==cp.revision)return this.needsChoice("本机和云端都已修改，自动同步已暂停。",remote,local);
      else action=remote.revision!==cp.revision?"remote":"local";
    }
    if(action==="remote"){
      if(!remote.data)throw new Error("云端还没有数据，无法下载；可选择上传本机数据");
      const next=this.nextCheckpoint(remote,remote.data);
      await this.io.applyRemote(remote.data,local,next);this.checkpoint=next;
    }else if(action==="local"){
      await this.io.backup(remote);
      if(fingerprint(this.io.readLocal())!==fingerprint(local))return this.needsChoice("本机数据在同步期间发生变化，请重新确认。",remote,this.io.readLocal());
      const result=await this.io.request("PUT",{schemaVersion:1,baseRevision:remote.revision,serverId:remote.serverId,data:local});
      if(result.status===409){const latest=await this.fetchRemote();return this.needsChoice("上传时云端已变化，服务器拒绝覆盖。请选择同步方向。",latest,this.io.readLocal());}
      checkStatus(result.status);const accepted=validateRemote(result.body,this.config);
      if(accepted.serverId!==remote.serverId||accepted.revision<=remote.revision||!accepted.data||fingerprint(accepted.data)!==fingerprint(local))throw new Error("服务器未确认本次完整数据，已停止同步");
      const next=this.nextCheckpoint(accepted,local);await this.io.saveCheckpoint(next);this.checkpoint=next;
    }else{const next=this.nextCheckpoint(remote,local);await this.io.saveCheckpoint(next);this.checkpoint=next;}
    this.conflict=null;return {message:this.dirty?"本次同步成功，新增修改等待下次同步。":"已同步"};
  }
}
