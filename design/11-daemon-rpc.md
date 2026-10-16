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

**修复记录（2026-10-16，引擎事件三重投递）**：真实使用中发现每轮对话后 UI 工具卡成倍
增加（第三轮起每条事件渲染 3 次）。根因：`daemon/index.js` 的 `pipeEngine()` 在每次
`engine.start`（渲染器每轮都重发）/ 定时任务 / 桥接轮次时调 `EngineHost.pipeEvents()`，
而后者往 `EngineHandle.listeners`（Set）**追加新闭包**，注释宣称幂等实际不幂等——事件
被转发 N 份。对照 wb：渲染器 ACP 累积器把 `tool_call`/`tool_call_update` 按 toolCallId
**合并进同一张卡**（contexts chunk 的 mergeToolStatus：findIndex→原地 merge），所以 wb
不显示重复卡；wb cli 也在工具文本进 UI 前剥离 ANSI（AnsiUtils.replaceAnsiColor）。
修复（对齐 wb 语义）：① `EngineHandle.pipe()` 替换式管道——重挂管道只换监听器不叠加
（T05 单测 + T04c 三轮重复 start 集成回归）；② 渲染器同一 callId 的 tool_result 原地
更新到 tool_call 卡上、标题显示工具名而非裸 call ID；③ 失败的 tool_result 事件携带
stderr/stdout 尾部 `detail`（LLM 侧数据不变，T04d）；④ browser 工具错误摘要剥离
playwright 的 `\x1b[2m` ANSI 码（T06）。清单偏差新增 D10：assistant/tool 消息未落库
（重开会话只剩 user 消息），修复计划见 wb-feature-inventory §5。
