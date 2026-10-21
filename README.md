# Todo

一个面向 Windows 10/11 的轻量浮窗待办应用，使用 Tauri 2、React、TypeScript 和 Rust 构建。

## 功能

- 最多三级任务；折叠、拖动排序，完成上级时同时完成下级；取消勾选任意层级会同时取消其下级，并让所有上级回到待办，整棵任务移出已完成列表。
- 自定义颜色分组、分组排序、按分组清空已完成任务，以及全部已完成任务清理。
- 日期时间提醒；按天、周、月、年或中国法定工作日／节假日重复，新增任务并保留历史，未完成的过期提醒标红。
- 编辑任务文字时按 Tab 在下方添加同级任务并继续输入；顶部输入框也支持 Tab 提交。空内容不新增，Shift+Tab 保持切换焦点。
- 各级任务独立选择从顶部或底部添加。
- 父任务可为直接子任务启用数字、括号数字或大小写字母编号。
- 置顶、悬浮球模式（主界面缩为小球，可拖动移动位置，可配合置顶使用，点击小球还原）、系统托盘、开机启动和本地自动保存。
- 可选自托管同步：桌面端支持手动／自动同步、冲突选择与本地备份；`server/` 提供 Docker + SQLite 后端初版，支持独立用户令牌及历史备份。
- 工具箱支持本地文件、快捷方式、文件夹及自定义名称、图标。
- 内置项目任务 HTML 工具和工作日历；A 股交易日历标记为待实现。工具删除按钮仅在编辑模式显示。

日历当前在主窗口内显示；内置 holiday-cn 的 2025、2026 年节假日数据，支持手动联网更新所查看年份及相邻年份，并与重复任务共用本地缓存。无需 API Key，更新失败保留原数据。更新只在手动点击时联网；未知年度暂停生成节假日相关重复任务，公布后更新即可恢复。首次提醒日期不符合所选重复规则时自动顺延到匹配日期。

“法定工作日”排除放假、包含调休补班；“法定节假日”按数据的 `isOffDay: true` 日期生成，不包含所有普通周末。holiday-cn 不会单独记录部分“与周末连休”的普通周末。已有历史任务不会因数据更新而删除。Tab 快捷添加固定在当前任务下方，普通添加按钮和重复任务仍遵循各级顶部／底部设置。

数据来自 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)，依据国务院公告整理，采用 MIT 许可；随项目保留于 `third-party/holiday-cn-LICENSE.txt`。联网依次尝试 GitHub Raw、jsDelivr、GitHub 公共接口，每个请求有超时。Windows 系统通知在安装后的应用中工作更可靠。

## 项目结构

```text
Todo/                         # 请在此目录初始化 Git
├─ src/                       # React 界面、任务和提醒逻辑
├─ src-tauri/                 # Rust 桌面端、Tauri 配置与资源
│  ├─ src/
│  ├─ capabilities/
│  ├─ icons/
│  ├─ tools/                  # 安装包内置 HTML 资源
│  └─ target/                 # 本地 Rust 编译产物，不提交
├─ public/                    # 前端静态资源
├─ tools/                     # 供本地可运行 exe 使用的 HTML 资源
├─ scripts/                   # 构建产物归档脚本
├─ tests/                     # 使用模拟任务数据的回归验证
├─ server/                    # 可选自托管同步后端与 HTTP 部署文档
├─ docs/                      # 自托管同步后端接口约定
├─ releases/                  # 可运行 exe、历史版本及安装包，不提交二进制
│  ├─ Todo.exe                # collect:exe / build:exe 归档的当前版本
│  ├─ Todo-v0.9.2-floating-ball.exe # 保留原始历史版本名
│  ├─ tools/                  # exe 运行时需要的工具文件
│  └─ installers/             # 安装包归档
├─ test-results/              # 验证截图，不提交
├─ node_modules/              # 本地 npm 依赖，不提交
├─ dist/                      # 前端构建结果，不提交
├─ package.json
├─ package-lock.json
└─ README.md
```

修改内置 HTML 时，请保持 `tools/` 与 `src-tauri/tools/` 中对应文件一致；前者供本地 exe 使用，后者用于安装包资源。 改名时，还需同步 `src-tauri/tauri.conf.json` 的资源路径及 `src/main.tsx` 中的工具箱入口。归档脚本会把旧工具文件名更新为跳转页，供历史 exe 使用。

`.npm-cache/`、`src-tauri/gen/schemas/` 等缓存和自动生成内容也已忽略。迁移时保留了现有 npm 依赖；Rust release 编译缓存因包含旧目录绝对路径已清理并重新构建，之后可按需重建。请保留 `package-lock.json` 和 `src-tauri/Cargo.lock`，方便复现依赖版本。

## 本地运行

开发环境需要 Node.js 22.12+（或更新的受支持 LTS 版本）与 npm、Rust stable（MSVC 工具链）、Visual Studio C++ 桌面开发工具，以及 WebView2 Runtime。

在项目根目录执行：

```powershell
cd "$env:USERPROFILE\Desktop\workspace\aiproj\Todo"
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npm ci
npm run tauri -- dev
```

克隆到其他位置时，把 `cd` 路径替换为你自己的仓库目录。已有完整依赖时，无需每次执行 `npm ci`。

仅验证前端构建可执行 `npm run build`；桌面功能需要在 Tauri 中运行。

## 构建可运行 exe

```powershell
npm run build:exe
```

成功后会将当前版本归档为 `releases/Todo.exe`，并复制所需的 `releases/tools/` 资源。原始编译结果仍位于 `src-tauri/target/release/app.exe`。

若仅想归档已成功编译的版本，可执行 `npm run collect:exe`。

单独移动 exe 时，请一并保留它旁边的 `tools/` 文件夹，否则内置项目工具可能无法打开。安装版由安装包负责携带资源。

## 生成安装包

```powershell
npm run build:installer
```

NSIS 安装包生成在 `src-tauri/target/release/bundle/nsis/`，同时复制到 `releases/installers/`。安装包版本取自 `src-tauri/tauri.conf.json` 的 `version`，不会根据历史 exe 文件名自动变化。

归档中保留了迁移前的旧安装包；文件存在不代表它包含最新功能。发布新版时请重新构建。

## 功能验证

回归验证使用模拟任务和设置，不读取或修改真实用户数据。浏览器验证默认使用本机 Microsoft Edge。

Playwright 仅用于开发验证，不是运行应用所需的依赖。需要执行验证时可先临时安装：

```powershell
npm install --no-save --package-lock=false playwright
npm test
```

`npm test` 会先构建前端，再依次验证新增任务位置、分组顺序、重复提醒、选项框、列表编号、节假日及同步流程。同步测试使用模拟接口，不连接真实云端，也不读取真实凭据。截图写入 `test-results/`。

已有 Playwright 模块时，也可通过环境变量 `TODO_PLAYWRIGHT_MODULE` 指定模块路径，无需重复安装。验证脚本中未写死个人电脑路径。

## 用户数据

用户任务和设置位于项目目录之外：

```text
%APPDATA%\com.aiproj.todo\
├─ tasks.json
├─ tasks.backup.json
├─ preferences.json
├─ reminders-sent.json
├─ holidays.json              # 手动更新的节假日缓存
├─ sync-config.json           # 同步地址、用户 ID、自动同步开关、频率及编辑同步选项，不含令牌
├─ sync-state.json            # 上次同步检查点
├─ sync-backups/              # 最近 50 份同步覆盖前备份
└─ sync-apply.pending.json    # 仅事务提交期间存在；下次读取自动恢复
```

移动源代码和历史 exe 不会迁移或删除这些用户数据。卸载时保留应用数据，重装即可继续读取。开机启动以 Windows 当前注册状态为准；如果改变了正在使用的 exe 路径，可在新路径下重新切换开机启动设置。

项目任务工作台 HTML 工具的浏览器进度由该工具单独保存；移动 HTML 后浏览器是否沿用原数据取决于浏览器的本地文件存储规则，重要记录可使用工具自身的导出功能备份。

## 自托管同步客户端

设置面板中新增“自托管同步”。默认关闭；未配置时沿用原有本地保存。当前一次连接一个用户，预留用户 ID 入口，单用户使用 `default`。更换服务器或用户时必须重新选择同步方向，不会自动把原用户的任务上传到新用户。

填写服务器根地址（可带反向代理前缀）、用户 ID 和访问令牌，先保存，再测试连接或立即同步。默认支持 HTTPS；如需使用 `http://服务器IP:端口`，勾选默认关闭的“允许 HTTP 连接”后保存。HTTP 明文传输令牌及任务内容。本机调试地址仍可直接使用 HTTP。以后改填 HTTPS 地址、取消 HTTP 选项并重新填写令牌即可，协议不变；地址变更后需要重新选择同步方向。令牌仅保存在当前 Windows 用户的凭据管理器，不保存在普通配置、同步数据或日志中；令牌输入框保存后清空，留空表示保留该账户已保存的令牌。清除令牌前先关闭自动同步。

自动同步开启时，启动或保存同步配置后检查一次。默认开启编辑后约 3 秒同步；定时同步默认 15 分钟，支持 1 分钟、30 分钟、1 小时或自定义 1–1440 分钟。每次成功同步后重新计时，恢复可见时仅在到期后检查；断网失败后至少间隔 60 秒重试。关闭编辑后同步仍保留定时同步；关闭自动同步总开关仅保留手动同步。首次连接需选择本机／云端；两端都修改时暂停并要求选择。上传、下载覆盖前备份，两端数据不自动合并。下载使用本地事务恢复文件，工具箱路径、窗口、开机启动和已发送通知记录保持本机状态。

同步属于可选功能；不部署服务器也可继续本地使用。后端初版位于 `server/`，支持用 Docker Compose 部署、独立用户令牌、版本冲突保护及数据库备份；详见 [server/README.md](server/README.md)。当前没有网页注册、管理后台或本地多用户独立工作区。接口约定见 [docs/sync-protocol.md](docs/sync-protocol.md)。后端已在本机容器验证，云服务器由用户自行部署。

令牌不能随普通数据文件迁移到另一台电脑，新设备需要重新填写。手动恢复备份前请退出应用，保留当前数据副本，再从 `sync-backups/` 对应备份的 `local.tasks` 和 `local.preferences` 恢复；备份也包含当时的远端同步数据，供处理冲突时参考。

## GitHub 发布

请在本 README 所在的 `Todo/` 目录初始化 Git。源代码、配置、锁文件、测试脚本、应用图标和内置 HTML 资源可以作为仓库内容提交。

`.gitignore` 已排除依赖、缓存、构建产物、exe、安装包、测试截图及常见本地数据文件。`releases/README.md` 会保留在仓库中说明产物位置。

可运行程序和安装包适合附加到 GitHub Releases；如发布便携版，可将 `Todo.exe` 和同级 `tools/` 一起打成 zip。Git 初始化、提交、远端关联和实际发布由你自行操作。

开源许可证尚未指定，留待仓库所有者选择。

后端单元/接口测试使用 Node.js 24，在 `server/` 执行 `npm test`，无需安装 npm 依赖。可选真实 Compose 联调在项目根目录执行 `node tests/backend-compose.cjs`：会创建独立临时 Compose 项目，验证现有桌面同步引擎、服务重启、备份导出与恢复，结束后只清理该测试项目。需要本机 Docker 可用及现有前端开发依赖。
