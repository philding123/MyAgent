# GEMINI.md — app/main 架构定位

进程树的根：OS 集成 + daemon 监护人。设计对齐 WorkBuddy「主进程窄通道 + 守护进程承载业务」——因此本目录代码量刻意很小（4 个文件），改业务先考虑 daemon。

## 运行

- `npm start`；冒烟 `MYAGENT_SMOKE=1 node node_modules/electron/cli.js .`（结果 JSON 在 MYAGENT_SMOKE_OUT）。
- deeplink 调试：第二实例 `electron . "myagent://session/<id>"`。

## 红线

1. 只允许 `rpc` / `rpc.window` 两个 IPC handle。
2. 冒烟退出码以结果 JSON 为准，勿信进程退出码。
3. 主窗关闭进托盘；真退出只能走托盘 Quit（`__myagentQuitting`）或冒烟路径。

## 模块索引

[index.js](index.js)（bootstrap+smoke）· [daemon-client.js](daemon-client.js)（RPC 客户端）· [windows.js](windows.js)（窗口）· [tray.js](tray.js)（托盘/deeplink）
