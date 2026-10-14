# 01 · 总体架构

对标观察：WorkBuddy 是 Electron 37 单壳应用，主进程 152 个模块只暴露 28 个窄 IPC 通道，
业务全部经 `wb:invoke` 一条总线打到常驻守护进程（CellJS + better-sqlite3），
agent 执行引擎是独立打包的 CodeBuddy CLI（headless 子进程，预热池管理）。
（证据：`main/index.js` 提取 grep handle() 28 个通道；`main_daemon-bootstrap.js` 字符串
`invoke:request/invoke:response/conversations:snapshot/imChannels:realtime`；
`main/cli-prewarm-pool.js` 反混淆源码。）

## 1. 进程模型

```
┌ electron main (main/) ─────────────────────────────────────┐
│ 窗口管理 / 托盘 / deeplink / 全局快捷词                       │
│  renderer(1..n) ⇄ contextBridge(preload) ⇄ ipcRenderer      │
│        invoke('rpc', {method, params})  ← 唯一宽通道          │
└──────┬─────────────────────────────────────────────────────┘
       │ child_process.fork (Node IPC)
┌──────▼ daemon (daemon/) ───────────────────────────────────┐
│ RPC 分发 / 会话与消息 DAO / 技能装载 / 记忆 / 设置            │
│ 沙箱规则引擎 / 搜索 / 自检 / 日志                             │
│  engine-host: 会话↔引擎子进程映射，事件转发，确认门控          │
└──────┬─────────────────────────────────────────────────────┘
       │ spawn (stdio JSON-Lines)
┌──────▼ engine (engine/) ───────────────────────────────────┐
│ agent loop：LLM(OpenAI 兼容) ⇄ tools(read/write/list/       │
│ run_command/search)；流式事件 stdout；控制消息 stdin          │
└────────────────────────────────────────────────────────────┘
```

对齐点：
- UI 崩溃/重开不杀任务：daemon 与 engine 均独立于 renderer 生命周期（对应 WorkBuddy
  "后台任务终端输出"、"stale-conversation-status-writeback" 的守护进程语义）。
- 主进程窄通道：除 `rpc`、窗口控制最小集外，不再新增业务 IPC。

## 2. RPC 协议（`rpc:invoke`，对应 `wb:invoke`）

请求：`{ id, method, params }`；响应：`{ id, ok, result | error:{code,message} }`。
流式事件不经 RPC 请求-响应，走 daemon→main→renderer 的推送通道
`rpc:event { topic, payload }`（对应 `imChannels:realtime`/引擎 token 流）。

方法表（daemon 注册，含权限分类 all|none）：

| method | 说明 |
|---|---|
| `app.version` / `app.selfcheck` | 版本与健康自检 |
| `sessions.list/create/get/append/delete/rename` | 会话 CRUD |
| `settings.get/set` | 设置 KV |
| `skills.list/scan/install/uninstall/toggle` | 技能（含本地市场安装） |
| `memory.get/set/append` | 记忆 |
| `engine.start/stop` | 启停某会话引擎 |
| `engine.userMessage` | 用户输入（引擎流式回复经 `topic:engine:{sessionId}` 推送） |
| `engine.confirm` | 危险命令批准/拒绝（对应弹窗门控） |
| `engine.mode` | 切换 ask/plan/craft |
| `terminal.create/write/resize/kill` | PTY 终端 |
| `search.query` | 全局搜索 |
| `fs.pickDirectory` | 目录选择（主进程 dialog） |

## 3. 数据模型（SQLite；表结构即 DAO 契约）

```sql
sessions(id TEXT PK, title TEXT, mode TEXT, created_at INTEGER, updated_at INTEGER, cwd TEXT)
messages(id TEXT PK, session_id TEXT, role TEXT, content TEXT, tool_name TEXT, tool_json TEXT,
         created_at INTEGER)          -- role: user|assistant|tool|system-event
settings(key TEXT PK, value TEXT)     -- JSON value
memory(id TEXT PK, kind TEXT, content TEXT, created_at INTEGER)  -- kind: fact|preference
logs(ts INTEGER, level TEXT, scope TEXT, line TEXT)
```

WAL 开启；启动时 `wal_checkpoint(TRUNCATE)`（对应 `wal-checkpoint-worker.js`）。
库文件损坏 → 备份后重建空库并在 UI 提示（对应 `database-recovery-modal`）。

## 4. 技术栈与降级矩阵

| 层 | 首选 | 降级 |
|---|---|---|
| 壳 | electron ^37 | — |
| 存储 | better-sqlite3（Electron prebuild） | JSON 文件存储（同 DAO 接口，`store.mode='json'`） |
| PTY | @lydell/node-pty（自带 win32 prebuild） | child_process 管道（`terminal.kind='pipe'`） |
| 渲染 | marked + highlight.js + katex（esbuild 本地打包） | 纯文本 |
| LLM | OpenAI 兼容 chat/completions + tools | 测试 mock server |

能力探测在 daemon 启动时完成并写入 selfcheck 报告；E2E 断言按实际能力分支。

## 5. 配置约定（个人使用）

设置存 `settings` 表，环境变量仅用于覆盖数据目录（`MYAGENT_HOME`）与引擎默认模型。
不内置任何遥测上报（F18 的"日志"仅本地文件 + UI 查看；这是与 WorkBuddy
aegis/galileo/qimei 的刻意偏离，见 90-deferred.md §合规）。

## 6. 构建与运行

- `node scripts/build.mjs`：esbuild 打包 renderer（app.js + vendor）、preload。
- `npm start`：`electron .`
- `node scripts/smoke.mjs`：E2E 冒烟（隐藏窗口启动，断言后带码退出）。
- 单元/集成测试用系统 Node 直接跑（`node --test tests/...`），不依赖 Electron；
  涉及 daemon/engine 的集成测试直接以子进程方式拉起真实模块。
