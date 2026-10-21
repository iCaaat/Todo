# 本地程序归档

此目录保存本机生成的可运行 exe、历史版本、运行时工具资源，以及 `installers/` 中的安装包。

- 当前功能版本：`Todo-v0.9.2-floating-ball.exe`（悬浮球可拖动、已完成列表取消勾选逻辑、按分组清空已完成）。
- `Todo.exe`：执行 `npm run collect:exe` 或成功执行 `npm run build:exe` 后归档的当前构建。
- `tools/`：本目录中 exe 使用的内置 HTML 资源；请与 exe 一起保留。
- `installers/`：安装包；旧文件不代表当前源码的最新构建。

二进制文件与资源副本已由 `.gitignore` 排除，仅保留本说明。需要发布程序时，可将它们上传至 GitHub Releases；便携版请将 exe 与同级 `tools/` 一起打包。

项目开发与构建方法见上一级 `README.md`。
