# 13 · 桌面集成：窗口 / 终端 / 搜索 / 托盘 / Deeplink（F01 F14 F15 F16）

## F01 桌面壳与多窗口

**WorkBuddy 观察**：独立窗口框架 chunks：`independent-window`、`builtin-window-apps`、
`settings-window-app`、`conversation-window-app`、`developer-profile-window-app`、
`bootstrap-independent-window`、`window-controls`、`mac-close-button`、
`appearance-cross-window-sync`（跨窗主题同步）；主窗口导航 `main-window-navigator`。

**复现设计**：`main/windows.js` 窗口注册表：`main`（聊天主窗）、`settings`（设置窗）、
`search`（全局搜索窗，无边框小窗）。窗口按需创建、单例复用；
主题变量集中一处，向所有窗广播 `appearance` 变更（对齐 cross-window-sync 语义）。

**验证**：E2E 冒烟：主窗创建 → 发 RPC 打开设置窗/搜索窗 → 断言两个 WebContents 存在且
加载完成 → 关闭全部窗应用退出。T01。

## F14 内置终端

**WorkBuddy 观察**：node-pty + ConPTY 全家桶随包（`OpenConsole.exe`、conpty.dll、
`winpty` 兼容层、`@lydell/node-pty` 预编译）；渲染端 `desktop-terminal-view`、
`xterm`、`background-task-terminal-output`（后台任务输出回显终端）。

**复现设计**：daemon `terminal.js`：优先 `@lydell/node-pty`（`terminal.kind='pty'`），
失败降级 `child_process.spawn(cmd)`（`kind='pipe'`）。数据经
`topic:terminal:{id}:data` 推送；`terminal.create` 返回 `{id,kind,shell}`。
渲染端 xterm.js（纯 JS，esbuild 打包），fit 插件可选（不做，用固定行列）。

**验证**：集成测试创建终端，写入 `echo`/`dir` 命令，断言收到含标记串的数据事件并正常退出；T14。
（降级模式下同样通过，报告标注 kind。）

## F15 全局搜索

**WorkBuddy 观察**：`extensions/global-search/extension.json` 原文描述：
「全局搜索 —— 独立操作系统窗口，跨任务/空间/项目/产物检索并跳转定位」。

**复现设计**：daemon `search.js`：`search.query{q, scope?}` 同时搜：
- 会话库（messages.content LIKE，返回会话+消息定位）； 
- 工作区文件（递归遍历 session.cwd，忽略 node_modules/.git/二进制，行级命中 + 行号）。
结果统一 `{type:'message'|'file', ...locator}`；UI 点击跳转（会话高亮该消息 / 文件在终端展示路径）。

**验证**：集成测试预置会话与临时工作区文件，断言两类命中与定位字段；T15。

## F16 托盘 / Deeplink

**WorkBuddy 观察**：`deeplink`、`deeplink-landing`、`parse-buddy-preview-deeplink` chunks
（自家协议链接落地）；`default-open-handler.win32.js`（默认打开处理）；
`app:consumePendingOpenUrls` IPC 通道（冷启动时暂存待处理的 URL）——这是 Windows 上
经典实现：协议回调先到已运行实例/或首实例启动参数，需排队等 renderer 就绪。

**复现设计**：注册 `myagent://` 协议（`app.setAsDefaultProtocolClient`）；
`app.on('open-url')`（mac）/ 第二实例 `second-instance` + `process.argv` 解析（win）；
URL 进入 pending 队列，renderer ready 后经 `app:consumePendingOpenUrls` 等价 RPC
（`app.pendingUrls`）下发并跳转会话（`myagent://session/<id>`）。
托盘：图标 + 显示/隐藏 + 退出；关闭主窗默认隐藏到托盘（个人用选择，记录偏离：
WorkBuddy 用 dock-recent 修复等更复杂行为，简化）。

**验证**：E2E：第二实例带 `myagent://session/x` 参数启动，断言首实例收到并消费；
托盘存在性断言（有托盘对象即可，交互不自动测）。T16。
