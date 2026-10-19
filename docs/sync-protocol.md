# Todo 自托管同步协议 v1（客户端与后端初版已实现）

客户端当前一次连接一个服务器用户。设置预留 `userId`，单用户服务器使用 `default` 即可；服务器以后可以实现多用户，不需要改同步数据结构。客户端不提供注册、账户管理或本地多账户工作区，切换服务器或用户会解除本机数据的旧绑定，重新要求选择同步方向。

## 认证与地址

设置中的服务器地址为根地址或反向代理前缀，例如 `https://todo.example.com`、`https://example.com/todo`。客户端自动追加：

```http
GET /api/v1/users/{userId}/sync
PUT /api/v1/users/{userId}/sync
Authorization: Bearer <token>
Accept: application/json
Content-Type: application/json
```

`userId` 为 1–64 位 ASCII 字母、数字、点、下划线或短横线，大小写敏感。它是数据命名空间，不是认证依据；后端必须验证 Token 所属用户有权访问路径中的用户。不同用户的数据、版本和历史备份必须隔离。Token 不应放在 URL 或访问日志中。

远程地址默认要求 HTTPS 并校验证书。设置中显式勾选“允许 HTTP 连接”并保存后，也支持 `http://服务器IP:端口` 或 HTTP 域名；该选项默认关闭，仅本机 `localhost`、`127.0.0.1`、`[::1]` 调试例外。HTTP 会明文传输令牌和任务内容。后续配置 HTTPS 后，改填新地址、取消 HTTP 选项、重新填写令牌并保存即可，无须更改同步协议或重新安装客户端；地址变更会重新要求选择同步方向，不自动迁移凭据或沿用检查点。客户端通过 Windows WinHTTP 工作线程请求，无浏览器 CORS 要求；禁用自动重定向、自动 Windows 身份认证和 Cookie，避免令牌被转发到其他地址。请直接填写最终服务器地址。

## GET 响应

HTTP 200，JSON；建议响应包含 `Cache-Control: no-store`：

```json
{
  "schemaVersion": 1,
  "serverId": "server-unique-id",
  "userId": "default",
  "revision": 0,
  "updatedAt": null,
  "data": null
}
```

上面表示该用户尚无数据。`data: null` 仅允许出现在 `revision: 0`。已经上传过的空任务列表应使用正常 `data` 对象与正整数版本，不能把“用户清空了任务”当成“尚无数据”。

- `serverId` 是持久化的服务器实例 ID（建议随机 UUID），重启或正常升级保持不变；数据库整体重置或重新创建时更换，避免客户端误覆盖新服务器。
- `userId` 必须与请求路径一致。
- `revision` 是非负、安全整数，成功写入一次递增一次；同一版本的数据不可变。请控制在 JavaScript 安全整数范围内。
- `updatedAt` 是 ISO 8601 时间戳，推荐 UTC；空库时为 `null`。
- `schemaVersion` 当前严格为 `1`。不支持的版本会被客户端拒绝，不修改本机数据。

`data` 示例：

```json
{
  "tasks": [
    {
      "id": "a-unique-task-id",
      "text": "完成项目方案",
      "done": false,
      "collapsed": false,
      "groupId": "daily",
      "children": [],
      "reminderAt": "2026-10-19T09:55:00.000Z",
      "reminder": "2026-10-19T17:55",
      "repeat": "workday"
    }
  ],
  "groups": [
    {"id": "daily", "name": "日常", "color": "#4b9b72", "collapsed": false}
  ],
  "taskPlacement": {"level1": "top", "level2": "bottom", "level3": "bottom"}
}
```

数组顺序即用户排序。任务最多三级，任务 ID 在整个快照内唯一；任务的非空 `groupId` 必须存在于 `groups`。保留客户端提供的任务 ID、时间戳、顺序和重复周期元数据，不重新生成或格式化。

可选任务字段：`reminder`、`reminderAt`、`repeat`、`childListStyle`、`repeatSeries`、`repeatAnchor`、`repeatIndex`、`repeatArchived`。重复方式：空字符串、`daily`、`weekly`、`monthly`、`yearly`、`workday`、`holiday`。`childListStyle` 为：空字符串、`decimal`、`parenthesized`、`lower-alpha`、`upper-alpha`。

`remindedAt`、`repeatPending` 不在同步数据内：通知发送状态和等待本地节假日数据的状态由各设备管理。工具箱本地文件路径、开机启动、窗口状态、Token、服务器配置、节假日缓存不上传。

客户端限制：最多 10,000 项任务、1,000 个分组，单次请求或响应上限约 4 MB。后端应同样限制请求体并验证数据结构。

## PUT 请求与并发控制

```json
{
  "schemaVersion": 1,
  "serverId": "server-unique-id",
  "baseRevision": 18,
  "data": {"tasks": [], "groups": [], "taskPlacement": {"level1": "bottom", "level2": "bottom", "level3": "bottom"}}
}
```

后端须在同一数据库事务中执行身份检查、版本检查、保存和版本递增：

1. Token 对请求用户有效。
2. `serverId` 与服务器一致，`baseRevision` 等于该用户当前版本。
3. 写入完整 `data`，版本加一，并保留服务端历史备份。
4. HTTP 200 返回完整 GET 格式的最新快照，包含新版本和与上传一致的数据。

不能无条件覆盖，也不能只返回 `{ "ok": true }`。版本冲突或服务器 ID 已变化时返回 HTTP **409**，且不写入。客户端会重新 GET 并要求用户选择。

状态码约定：200 成功；401/403 认证或权限失败；409 版本/服务器冲突；413 数据过大；其他 4xx/5xx 为失败。无须实现单独的“测试连接”接口：客户端使用只读 GET 校验协议及身份，不应用返回任务。

## 客户端同步行为

- 默认关闭。未配置时只本地保存，不请求同步服务器。
- 自动同步开启后，启动或保存同步配置时检查一次。默认启用编辑后约 3 秒同步，可单独关闭；定时间隔默认 15 分钟，可选 1、15、30、60 或自定义 1–1440 分钟，每次同步成功后重新计时。恢复可见时仅在定时到期后检查。断网后保留本机内容，自动重试间隔至少约 60 秒。频率和编辑同步开关保存在本机 `sync-config.json`，旧配置默认 15 分钟且保留编辑后同步，不改变服务器协议或用户绑定。
- 首次连接、切换用户或服务器、服务器重置，先选择使用本机还是云端数据。云端尚无数据时只能上传，不能下载空库清除本机。
- 已建立基线后，仅本机改变则上传，仅远端改变则下载；两端都改变时暂停，保留两端供选择，不自动合并。
- 选择后重新 GET；如果本机或云端又变化，要求重新确认。上传仍使用版本条件，即使用户选择本机也不能跳过并发校验。
- 上传期间继续编辑的内容保持在本机；上传确认只记录实际上传的快照，后续再上传新增修改。
- 下载前检查本机内容未变化，写入备份；任务、同步设置及检查点通过本地事务恢复文件一起提交，进程中断后下次读取完成恢复。
- 备份位于 `%APPDATA%\com.aiproj.todo\sync-backups\`，保留最近 50 份，包含当时本机任务/设置与远端数据；不含访问令牌。此备份用于恢复，不是加密云端备份。

后端只做认证、隔离、版本管理和快照保存；提醒、重复任务生成均在客户端执行。参考实现及部署说明位于 `server/`：Node.js 24 内置 SQLite、Docker Compose、命令行用户管理、每用户最近 50 个历史版本及手动数据库备份。已使用现有桌面同步引擎连接本机 Docker 后端验证；尚未部署到用户云服务器。健康检查为 `GET /healthz`，无须令牌，不返回任务或用户信息。用户管理和备份不通过 HTTP 暴露。
