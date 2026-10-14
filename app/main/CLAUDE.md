# CLAUDE.md — app/main

@AGENTS.md

Electron 主进程：窗口/托盘/deeplink/daemon 生命周期。业务逻辑为零——全部经 DaemonClient RPC 转发。

## 常用命令

```bash
npm run build                      # 渲染层改动后先 build
npm start                          # 启动（GUI）
MYAGENT_SMOKE=1 MYAGENT_SMOKE_OUT=artifacts/smoke-result.json node node_modules/electron/cli.js .   # E2E 冒烟（隐藏窗口，结果 JSON 带退出码）
npm run verify                     # 全量验收（含上面这步）
```

## 🚫 绝对禁止

- **不得新增 ipcMain.handle 业务通道**：只允许 `rpc` 与 `rpc.window`（窗口动作/主题/目录选择）。
- 不得在主进程 require 业务模块（daemon/engine 的模块）——职责边界。
- 不得把 `app.exit`/`process.exit` 当作可靠退出（Windows 下 Electron 进程树可能残留）；冒烟以结果 JSON 的 exitCode 为准，杀树用 taskkill /T /F。
- 不得移除 DaemonClient 的指数退避重连（≤5 次）与 pending 请求失败回包。

## ⚠ 强约束

- 单实例锁 + `second-instance` 是 Windows deeplink 的入口；`myagent://` URL 进 pendingUrls 队列，renderer ready 后经 `app:pendingUrls` 事件下发。
- 主窗关闭 = 隐藏到托盘（`__myagentQuitting` 才真退）；冒烟模式（MYAGENT_SMOKE）下窗口隐藏、close 直通。
- `windows.js` 主题广播 `appearance` 事件实现跨窗同步。

## 子文件路由

| 文件 | 职责 |
|---|---|
| `index.js` | 入口/bootstrap/smoke 测试（runSmoke + finishSmoke 结果 JSON） |
| `daemon-client.js` | fork daemon、请求多路复用、重连 |
| `windows.js` | 窗口注册表与主题 |
| `tray.js` | 托盘 + deeplink 解析（parseDeeplink） |
