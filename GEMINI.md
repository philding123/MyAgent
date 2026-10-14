# GEMINI.md — MyAgent 架构定位与开发纪律

## 架构全貌

个人 AI Agent 桌面工作台（WorkBuddy 复刻，无支付）。四个进程角色：

1. **Electron main**（`app/main/`）：窗口注册表（main/settings/search 单例复用）、托盘、`myagent://` deeplink 队列、DaemonClient（fork + 指数退避重连 ≤5 次）。
2. **Daemon**（`app/daemon/`，fork 常驻）：RPC 方法表是唯一业务入口；持有 SQLite/JSON 存储、技能注册表、沙箱规则引擎、全局搜索、PTY 终端、EngineHost（每会话一引擎 + 可选预热池）。崩溃后由 main 重启，UI 收 `daemon:status` 事件。
3. **Engine**（`app/engine/`，每会话一个子进程）：JSON-Lines 协议；OpenAI 兼容 chat/completions 工具循环（≤16 步）；模式策略（ask/plan/craft）在代码层强制；危险命令走 confirm_request → UI 批准回流。
4. **Renderer**（`app/renderer/`）：index/settings/search 三页面，esbuild 打包；消息渲染 marked → KaTeX → DOMPurify；xterm 终端面板。

数据流：用户输入 → renderer `myagent.invoke('engine.userMessage')` → daemon 落库并转发引擎 → 引擎事件流回推 `engine:{sessionId}` → UI 渲染；确认请求经同一总线往返。

## 常用命令与门禁

```bash
npm run build      # 渲染层打包（改 app/renderer 后必须）
npm start          # 启动应用
npm run verify     # 验收门禁：build + 32 单测 + 18 集成 + E2E 冒烟（隐藏窗口）
node scripts/real-llm-check.js   # 真实模型检查（~/.codex 配置，gpt-6.1-sol）
```

- 测试门禁：`npm run verify` 必须 ALL GREEN；测试文件名/用例名以 `T\d+` 开头，否则验收报告映射不到功能点。
- 集成测试 fork 真实 daemon + 本地 mock LLM，不依赖外网；真实 Key 只进加密 vault。

## 铁律与安全红线

- 沙箱 fail-safe：凭证目录三操作全 deny、workspace 外默认只读（`app/daemon/sandbox.js`）。
- API Key 只经 CredentialVault 加密；任何明文落盘即缺陷。
- 主进程窄 IPC（`rpc`/`rpc.window`），业务方法只进 daemon 方法表。
- ask 模式禁写禁执行由 `app/engine/policy.js` 代码强制。
- 支付/订阅类功能禁止实现（范围裁决）。
- 无任何遥测外发。

## 分级地图索引

- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) — 根指南与契约 SSOT
- [app/main/](app/main/AGENTS.md) · [app/daemon/](app/daemon/AGENTS.md) · [app/engine/](app/engine/AGENTS.md) · [app/renderer/](app/renderer/AGENTS.md) — L1 子模块（各含三件套）
- [app/preload/](app/preload/AGENTS.md) — 渲染桥安全边界
- [design/](design/AGENTS.md) · [tests/](tests/AGENTS.md) · [scripts/](scripts/AGENTS.md) · [skills/](skills/AGENTS.md) — L2 支撑模块
- 验收报告：`artifacts/acceptance-report.md`（verify.mjs 自动生成）
