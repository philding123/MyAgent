# 11 · 守护进程与 RPC 总线（F02）

**WorkBuddy 观察**：
- 主进程仅 28 个 handle 通道，其中 `wb:invoke` 是统一业务总线；
  daemon 侧协议字符串 `invoke:request` / `invoke:response`，另有
  `conversations:snapshot`（会话快照）、`imChannels:realtime`（实时推送）。
- daemon 入口 `daemon-app-server-entry.js` / `daemon-bootstrap.js`（210KB），
  业务服务在 `app-server-*`（database、mcp-apps-host、migration-runtime），
  还有 `bootstrap-daemon-in-main-process.js`（daemon 不可用时在主进程内引导，5.4KB）。
- `no-orphans.cjs` / `windows-job.cjs` / `job-object.node`：daemon 用 Windows Job Object
  绑定进程树，防止孤儿进程。

**复现设计**：
- `daemon/index.js`：`fork` 自 main；Node IPC 上实现长度前缀 JSON 帧
  （`invoke:request{id,method,params}` → `invoke:response{id,ok,result|error}`；
  事件 `invoke:event{topic,payload}`）。
- 方法注册表 `methods{}` + 每方法 `auth` 注记（本实现无多用户，注记保留以对齐其 enterprise-policy 思路）。
- 断线重连：main 侧 `DaemonClient` 监听 `exit`，指数退避重启（≤5 次），期间 renderer 收
  `topic:daemon:status=reconnecting`（对应 UI 的 `network-error-state`/`daemon` chunk 行为）。
- 孤儿防护：daemon 退出时遍历其 engine/terminal 子进程 kill；Windows 下使用
  `taskkill /T /F` 兜底（Job Object 的等价简化，记录偏离）。
- 快照：daemon 启动完成后主动推 `topic:daemon:ready {sessions, settings, skills, capabilities}`
  （对应 `conversations:snapshot`）。

**验证**：集成测试 fork 真实 daemon，跑方法表全量往返 + 断言 kill -9 daemon 后 main 重启它；
E2E 冒烟在真实 Electron 内做一轮 RPC 往返。T02/T03。
