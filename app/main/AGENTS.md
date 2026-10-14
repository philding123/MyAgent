# AGENTS.md — app/main 详细契约

## 1. 职责与定位

Electron 主进程。向上管理 OS 集成（窗口/托盘/协议/对话框），向下持有 daemon 生命周期。**不含业务逻辑**：renderer 的所有业务请求经 `ipcMain.handle('rpc')` 原样转发 daemon。

## 2. 结构与组件

| 文件 | 职责 | 关键点 |
|---|---|---|
| `index.js` | bootstrap：daemon 启动 → IPC handle → 托盘 → 主窗 → deeplink 队列 →（MYAGENT_SMOKE 时）runSmoke | `runSmoke` 覆盖 T01/T16/T17/T18 步骤，结果写 JSON（`MYAGENT_SMOKE_OUT`，含 exitCode 字段） |
| `daemon-client.js` | DaemonClient（EventEmitter） | request 多路复用（30s 超时回包）、`ready/down/event` 事件、重启退避 500ms→8s ≤5 次；shutdown 用 taskkill /T /F 树杀 |
| `windows.js` | main/settings/search 三窗单例注册表 | `broadcast('rpc:event')` 全窗广播；`setTheme` 跨窗同步；close-to-tray 仅主窗 |
| `tray.js` | 托盘菜单（Show/Quit）+ `parseDeeplink` | `myagent://session/<id>`、`myagent://settings`；icon 走 nativeImage dataURL |

## 3. 铁律与不变式

- **窄 IPC**：新增渲染层能力 = daemon 方法 + 既有 rpc 通道，绝不加第三个 handle。
- **冒烟退出协议**：result JSON 的 `exitCode` 是唯一权威（进程树可能存活）；verify.mjs 轮询 JSON 后负责收割 electron 进程。
- **deeplink 排队**：URL 先入 pendingUrls，`did-finish-load`/`daemon:ready` 后投递，防冷启动丢链接。
- 渲染层 `window.myagent` 由 preload 提供（ping/onEvent/invoke/windowAction）。

## 4. 开发与测试

- E2E：`npm run verify` 的 e2e-smoke 步骤；单跑见 CLAUDE.md 命令。
- 相关测试：T01/T16/T17/T18（冒烟步骤名即断言）。
- 已知坑：Electron 下载后 dist 需完整（缺 exe 时从 `%LOCALAPPDATA%/electron/Cache` 手动解压并写 `path.txt`）。
