import React,{useEffect,useState} from "react";
import {SyncController} from "./useSync";
import {SyncData} from "./sync";

const INTERVALS=[1,15,30,60];
export function SyncSettings({sync}:{sync:SyncController}){
  const [draft,setDraft]=useState(sync.config),[token,setToken]=useState(""),[clearToken,setClearToken]=useState(false),[customInterval,setCustomInterval]=useState(!INTERVALS.includes(sync.config.syncIntervalMinutes));
  useEffect(()=>{setDraft(sync.config);setToken("");setClearToken(false);setCustomInterval(!INTERVALS.includes(sync.config.syncIntervalMinutes));},[sync.config]);
  const changed=draft.server!==sync.config.server||draft.userId!==sync.config.userId||draft.enabled!==sync.config.enabled||draft.allowHttp!==sync.config.allowHttp||draft.syncIntervalMinutes!==sync.config.syncIntervalMinutes||draft.syncOnEdit!==sync.config.syncOnEdit||!!token||clearToken;
  const validInterval=Number.isInteger(draft.syncIntervalMinutes)&&draft.syncIntervalMinutes>=1&&draft.syncIntervalMinutes<=1440;
  const canConnect=sync.loaded&&!sync.busy&&!changed&&!!sync.config.server&&sync.config.hasToken;
  return <fieldset className="syncSettings" disabled={!sync.loaded||sync.busy}>
    <legend>自托管同步</legend>
    <label className="syncToggle"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.currentTarget.checked})}/>启用自动同步</label>
    <label className="syncToggle"><input type="checkbox" checked={draft.syncOnEdit} onChange={e=>setDraft({...draft,syncOnEdit:e.currentTarget.checked})}/>编辑后自动同步（约 3 秒）</label>
    <label>定时同步频率<select aria-label="定时同步频率" value={customInterval?"custom":String(draft.syncIntervalMinutes)} onChange={e=>{const value=e.currentTarget.value;setCustomInterval(value==="custom");if(value!=="custom")setDraft({...draft,syncIntervalMinutes:Number(value)});}}><option value="1">1 分钟</option><option value="15">15 分钟（默认）</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="custom">自定义</option></select></label>
    {customInterval&&<label>自定义间隔（分钟）<input aria-label="自定义同步间隔（分钟）" type="number" min="1" max="1440" step="1" value={Number.isFinite(draft.syncIntervalMinutes)?draft.syncIntervalMinutes:""} onChange={e=>setDraft({...draft,syncIntervalMinutes:e.currentTarget.valueAsNumber})}/></label>}
    {!validInterval&&<small>请输入 1–1440 分钟的整数。</small>}
    <label>服务器地址<input aria-label="同步服务器地址" type="url" placeholder="https://todo.example.com" value={draft.server} onChange={e=>setDraft({...draft,server:e.target.value})}/></label>
    <label className="syncToggle"><input type="checkbox" checked={draft.allowHttp} onChange={e=>setDraft({...draft,allowHttp:e.currentTarget.checked})}/>允许 HTTP 连接</label>
    {/^http:\/\//i.test(draft.server.trim())&&<small>当前地址使用 HTTP，令牌和任务内容以明文传输；远程地址需勾选上方选项。本机调试地址仍可直接使用。</small>}
    <label>用户 ID<input aria-label="同步用户 ID" autoComplete="off" value={draft.userId} onChange={e=>setDraft({...draft,userId:e.target.value})}/></label>
    <label>访问令牌<input aria-label="同步访问令牌" type="password" autoComplete="new-password" placeholder={sync.config.hasToken?"已安全保存，留空保留原令牌":"输入服务器提供的令牌"} value={token} onChange={e=>{setToken(e.target.value);setClearToken(false);}}/></label>
    {sync.config.hasToken&&<label className="syncToggle"><input type="checkbox" checked={clearToken} onChange={e=>{setClearToken(e.target.checked);if(e.target.checked)setToken("");}}/>清除当前账户保存的令牌</label>}
    <div className="syncButtons"><button type="button" disabled={!validInterval} onClick={()=>void sync.save(draft,token,clearToken).then(ok=>{if(ok)setToken("");})}>保存同步设置</button><button type="button" disabled={!canConnect} onClick={()=>void sync.test()}>测试连接</button><button type="button" disabled={!canConnect} onClick={()=>void sync.run()}>立即同步</button></div>
    {changed&&<small>请先保存设置再测试或同步。更换服务器或用户后，需要重新选择同步方向。</small>}
    <p className="syncStatus" role="status">{sync.status}</p>
    {sync.lastSyncAt&&<small>上次同步：{new Date(sync.lastSyncAt).toLocaleString()}</small>}
    {sync.conflict&&<button type="button" onClick={sync.openConflict}>处理同步选择</button>}
    <small>同步任务、分组及新增位置设置；工具箱本地路径、开机启动、窗口状态和通知发送记录留在本机。令牌由 Windows 凭据管理器保存。需部署配套的自托管后端。</small>
  </fieldset>;
}
function count(data:SyncData|null){let total=0;const visit=(items:SyncData["tasks"])=>items.forEach(t=>{total++;visit(t.children);});if(data)visit(data.tasks);return total;}
export function SyncConflictDialog({sync}:{sync:SyncController}){
  if(!sync.conflict||!sync.dialogOpen)return null;
  const {remote,local,reason}=sync.conflict;
  return <div className="modalBackdrop syncConflictBackdrop"><section className="modal" role="dialog" aria-label="同步方向选择" aria-modal="true">
    <h2>选择同步方向</h2><p>{reason}</p>
    <p>本机：{count(local)} 项任务；云端：{remote.data?`${count(remote.data)} 项任务（版本 ${remote.revision}）`:"尚无数据"}。</p>
    <p>下载会替换本机的同步内容；上传会替换云端的同步内容。覆盖前保留本机及云端备份，工具箱保持本机设置。</p>
    <div className="modalActions"><button type="button" disabled={sync.busy} onClick={sync.closeConflict}>稍后处理</button><button type="button" disabled={sync.busy||!remote.data} onClick={()=>void sync.run("remote")}>使用云端版本</button><button type="button" className="active" disabled={sync.busy} onClick={()=>void sync.run("local")}>使用本机版本</button></div>
  </section></div>;
}
