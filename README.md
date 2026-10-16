# Todo

一个面向 Windows 10/11 的轻量浮窗待办应用，使用 Tauri 2、React、TypeScript 和 Rust 构建。

## 功能

- 最多三级任务；折叠、拖动排序，以及完成上级时同时完成下级。
- 自定义颜色分组、分组排序和已完成任务清理。
- 日期时间提醒；重复任务按周期新增并保留历史，未完成的过期提醒标红。
- 各级任务独立选择从顶部或底部添加。
- 父任务可为直接子任务启用数字、括号数字或大小写字母编号。
- 置顶、系统托盘、开机启动和本地自动保存。
- 工具箱支持本地文件、快捷方式、文件夹及自定义名称、图标。
- 内置项目任务 HTML 工具和工作／交易日历入口。

日历当前在主窗口内显示；节假日数据以内置数据为准。Windows 系统通知在安装后的应用中工作更可靠。

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
├─ releases/                  # 可运行 exe、历史版本及安装包，不提交二进制
│  ├─ Todo.exe                # collect:exe / build:exe 归档的当前版本
│  ├─ Todo-v3.9-task-lists.exe # 保留原始历史版本名
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

`npm test` 会先构建前端，再依次验证新增任务位置、分组顺序、重复提醒、选项框和列表编号。截图写入 `test-results/`。

已有 Playwright 模块时，也可通过环境变量 `TODO_PLAYWRIGHT_MODULE` 指定模块路径，无需重复安装。验证脚本中未写死个人电脑路径。

## 用户数据

用户任务和设置位于项目目录之外：

```text
%APPDATA%\com.aiproj.todo\
├─ tasks.json
├─ tasks.backup.json
├─ preferences.json
└─ reminders-sent.json
```

移动源代码和历史 exe 不会迁移或删除这些用户数据。卸载时保留应用数据，重装即可继续读取。开机启动以 Windows 当前注册状态为准；如果改变了正在使用的 exe 路径，可在新路径下重新切换开机启动设置。

项目任务工作台 HTML 工具的浏览器进度由该工具单独保存；移动 HTML 后浏览器是否沿用原数据取决于浏览器的本地文件存储规则，重要记录可使用工具自身的导出功能备份。

## GitHub 发布

请在本 README 所在的 `Todo/` 目录初始化 Git。源代码、配置、锁文件、测试脚本、应用图标和内置 HTML 资源可以作为仓库内容提交。

`.gitignore` 已排除依赖、缓存、构建产物、exe、安装包、测试截图及常见本地数据文件。`releases/README.md` 会保留在仓库中说明产物位置。

可运行程序和安装包适合附加到 GitHub Releases；如发布便携版，可将 `Todo.exe` 和同级 `tools/` 一起打成 zip。Git 初始化、提交、远端关联和实际发布由你自行操作。

开源许可证尚未指定，留待仓库所有者选择。
