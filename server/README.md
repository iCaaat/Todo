# Todo 自托管同步服务 0.1.0

适用于现有 Todo Windows 客户端。支持多个独立用户、访问令牌认证、完整快照同步、版本冲突保护、SQLite 持久化、历史版本和数据库备份。没有网页管理后台或公开注册入口。

只需 Docker Engine 与 Docker Compose。镜像使用 Node.js 24 自带 SQLite，没有 npm 第三方运行依赖。Ubuntu 22.04、Linux x86_64 可用；几个用户使用时，2 核、约 3 GB 总内存的服务器可先试用，实际余量取决于已有服务。

## 1. 上传与启动

把完整 `server/` 文件夹上传到服务器，例如 `~/todo-sync/server/`；也可解压提供的 `Todo-sync-server-v0.1.0.zip`，压缩包中有 `server/` 文件夹。

```bash
cd ~/todo-sync/server
sudo docker compose up -d --build
sudo docker compose ps
curl -fsS http://127.0.0.1:18080/healthz
```

健康检查返回 `{"ok":true}` 即启动成功。浏览器打开根路径显示 404 是正常的，本服务不提供网页界面。

默认端口是 **18080**；请在云服务器安全组和系统防火墙放行需要访问的 TCP 端口。此 Compose 项目独立命名，不需要停止服务器其他容器。

需要换端口或绑定地址时，在启动前执行 `cp .env.example .env`，编辑 `.env` 中的 `TODO_SYNC_PORT` 或 `TODO_SYNC_BIND`，然后重新执行启动命令。默认无需创建 `.env`。

## 2. 创建用户

```bash
sudo docker compose exec -T sync node src/cli.mjs user add default
```

返回示例（实际令牌自动随机生成）：

```json
{"userId":"default","token":"这里是自动生成的访问令牌"}
```

保存这次输出的令牌。服务端只保存 SHA-256 摘要，不能找回原令牌；不要把真实令牌提交到 GitHub。没有默认密码，也不会自动创建用户。

添加更多用户时，替换用户 ID 即可：

```bash
sudo docker compose exec -T sync node src/cli.mjs user add alice
sudo docker compose exec -T sync node src/cli.mjs user add bob
```

用户 ID 区分大小写，长度 1–64，只能包含 ASCII 字母、数字、点、下划线和短横线。不同用户任务相互隔离。一个用户可在自己的多台设备上使用同一个 ID 和令牌。

## 3. 连接桌面客户端

在 Todo 的「设置 → 自托管同步」中填写：

| 字段 | 内容 |
|---|---|
| 服务器地址 | `http://服务器公网IP:18080`，不追加 `/api/...` |
| 允许 HTTP 连接 | 勾选 |
| 用户 ID | 例如 `default` |
| 访问令牌 | 创建该用户时返回的 `token` |

先保存设置，再测试连接、立即同步。第一台设备选择「使用本机版本」上传；其他设备先备份重要本地任务，再选择「使用云端版本」。确认连接后可开启自动同步。

HTTP 会明文传输令牌和任务内容。后续可增加 HTTPS 反向代理；然后改填 HTTPS 地址、取消 HTTP 选项并重新保存令牌，无须更改接口协议。若用 `/todo` 等前缀，代理必须剥离该前缀后转发到服务根路径。

## 4. 用户管理

```bash
# 列出用户、是否启用、版本号；不会列出令牌
sudo docker compose exec -T sync node src/cli.mjs user list

# 重置令牌，同时重新启用该用户；原令牌立即失效，任务保留
sudo docker compose exec -T sync node src/cli.mjs user rotate default

# 禁用用户，保留数据
sudo docker compose exec -T sync node src/cli.mjs user disable default
```

没有用户删除命令。重置令牌后，该用户各台设备需要更新令牌。

## 5. 数据、历史与备份

Docker 命名卷 `todo-sync_data` 保存 `/data/sync.sqlite` 及 SQLite WAL 文件；`todo-sync_backups` 保存 `/backups/` 数据库备份。实际卷名前缀随 Compose 项目名变化。重建镜像、更新代码或 `docker compose down` 会保留命名卷；**不要使用 `down -v`，它会删除数据和备份卷。**

每次成功覆盖前，在同一数据库事务内保留该用户旧版本，默认保留最近 50 个历史版本；未初始化的版本 0 不保存。历史与当前数据在同一数据库，不能代替数据库的异地备份。

```bash
# 列出 default 的历史版本
sudo docker compose exec -T sync node src/cli.mjs history default

# 导出某个历史版本为 JSON（将 3 替换为实际版本号）
sudo docker compose exec -T sync node src/cli.mjs history default 3 > default-revision-3.json

# 在线备份整个数据库，输出 /backups/ 下的实际文件名
sudo docker compose exec -T sync node src/cli.mjs backup

# 把备份复制到服务器普通目录，再按需下载到另一台机器
mkdir -p backups
sudo docker compose cp sync:/backups/. ./backups/
```

数据库备份包括所有用户、令牌摘要、当前任务、历史和服务器 ID。备份文件不含原始令牌，但包含任务资料，请按私有数据保存。数据库备份需要手动执行，本版没有自动备份调度；备份文件也不会自动清理。

需要恢复整个数据库时，先保存最新备份，再**停止同步服务**。下面命令会恢复所有用户，不是仅恢复一个任务：

```bash
sudo docker compose stop sync
# 将下面文件名替换为 /backups/ 中实际存在的备份
sudo docker compose run --rm --no-deps sync node src/cli.mjs restore /backups/实际备份文件名.sqlite --confirm
sudo docker compose up -d
```

恢复前会验证备份结构，并另存当前数据库备份。恢复后使用备份当时的令牌；备份后创建的用户或任务也会回退。客户端发现版本回退时会要求重新选择同步方向。不要在同步服务运行时执行 restore。

如果备份只在服务器普通目录，停止服务后先放回备份卷，并将该文件交给容器内的 node 用户，再执行上面的恢复命令：

```bash
sudo docker compose cp ./backups/文件名.sqlite sync:/backups/文件名.sqlite
sudo docker compose run --rm --no-deps --user 0:0 --cap-add CHOWN sync chown 1000:1000 /backups/文件名.sqlite
```

## 6. 更新与排错

更新前执行一次 `backup`。用新版本覆盖源码文件，保持 Compose 项目名与卷配置一致，然后：

```bash
sudo docker compose up -d --build
sudo docker compose logs --tail=100 sync
```

连接失败时依次检查本机 `/healthz`、云安全组/防火墙、客户端 HTTP 选项、用户 ID 与令牌。`401` 表示认证失败或用户被禁用，`409` 表示版本冲突，由客户端处理；同一来源一分钟内认证失败 30 次会短暂返回 `429`。

如果服务器拉取镜像失败，可在本机进入 `server/` 执行 `docker compose build`，再执行 `docker save -o todo-sync-image.tar todo-sync-server:0.1.0`；上传 tar 后在服务器 `sudo docker load -i todo-sync-image.tar`，然后 `sudo docker compose up -d --no-build`。

本版使用单实例服务 + SQLite，不配置多个副本。请求/响应上限约 4 MB、最多 10000 项任务、1000 个分组、三级任务。接口只提供健康检查和带认证的同步，不向网络公开用户管理或备份管理。

## 开发验证

Node.js 24 或更新受支持版本可直接运行 `npm test`，无需 `npm install`。也可用 Docker 的 Node.js 24 镜像挂载该目录运行测试。完整接口约定见项目根目录 `docs/sync-protocol.md`。
