# AGENTS.md — MyAgent 通用 Agent 指南（Single Source of Truth）

## 工程背景

MyAgent 是对标腾讯 WorkBuddy（逆向基线 `D:\tools\workbuddy\install\`，`@genie/workbuddy-desktop` v5.7.7）的**个人使用**复刻，2026-10-13 完成 Phase-1 并全绿验收。**明确排除支付/订阅**；腾讯专有服务（ImSDK/Turing/腾讯文档）不做，替代路线见 `design/90-deferred.md`。

三层进程模型（对应 WorkBuddy 的 wb:invoke 架构）：

```
Electron main (app/main)  ←窄 IPC: 'rpc' + 'rpc.window'→
  Daemon (app/daemon, fork)  ←Node IPC 对象通道→
    Engine (app/engine, fork, JSON-Lines on stdio)  ←OpenAI 兼容 /chat/completions→ LLM
```

## 契约（Single Source of Truth）

| 契约 | 内容 |
|---|---|
| RPC 请求/响应 | `{id, method, params}` → `{id, ok, result \| error:{code,message}}`；未知方法返回 `no_method` |
| RPC 事件 | daemon → main → 所有窗广播 `rpc:event`，topic：`engine:{sessionId}`、`terminal:{id}:data`、`terminal:{id}:exit`、`daemon:ready`、`daemon:status`、`app:update`（F21）、`app:sync`（F26）、`app:theme`（F29 主题切换，持久化于 `appearance.theme`） |
| daemon 方法表 | 唯一注册处 `app/daemon/index.js` `methods{}`；`app.selfcheck` 返回能力矩阵（store/terminal.kind/sandbox/skills/engine/vault/browser/im/market/sync/a2a） |
| 引擎 stdio | stdin 控制 `{type:init\|user\|confirm\|abort\|daemon_tool_result}`；stdout 事件 `{type:status\|token\|tool_call\|tool_result\|confirm_request\|done\|error\|daemon_tool_request}`（daemon_tool_* 是引擎工具回调 daemon 能力的桥，仅 market） |
| 存储 DAO | `openStore()` 返回 sqlite 或 json 实现，接口一致：sessions/messages/settings/memory/logs + health/checkpoint + importSession（F26 同步导入） |
| 沙箱规则 | 格式同 WorkBuddy `tsbx_rules.json`：env 展开 + `**` glob + `read\|write\|delete=allow\|deny`，首条命中生效，无命中走 fail-safe；`sandbox.backend=cloud` 时文件/命令工具走 e2b 兼容云沙箱（隔离责任转移，策略 kind 不变） |
| 技能 | `SKILL.md` frontmatter：name/description/allowed-tools/disable（支持 YAML 块标量 `>`/`\|`/`\|-` 与引号）；渐进披露（清单进 system，全文经 `skill_read`） |
| 技能市场 | 内置目录 `market/claude-skills/`（F53，anthropics/skills 锁 commit，`builtin:` 源 + tree_sha256；文档四件套 installable:false）先于远端源（F25 `market.url`）；`market.list` → `{catalogs, plugins}`；`market.builtin=false` 关闭 |
| IM 通道插件 | `{id, meta, capabilities, gateway, outbound, defaultReplyPolicy}`；入站 `{messageId, content[], sender, group?, timestamp, replyContext}`；500 环形去重；凭证入 vault `im.<channel>.token`（telegram 完整实现，slack/discord/dingtalk/feishu 骨架+真连手工，webhook 本地回环） |
| 引擎工具面 | read_file/list_dir/write_file/run_command/search/skill_read + `browser`（F22，read 动作 browse、click/fill/press/scroll 经 kindOf 归 exec 受策略门控）+ `market`（F25，daemon 桥）+ `agent_delegate`（F28，A2A 客户端） |
| 数据目录 | 真实：`%APPDATA%/myagent`（keystore/ data/ skills/）；测试用 `MYAGENT_HOME` 覆盖 |

## 不可破坏的全局不变式（Fail-Closed）

1. **窄 IPC**：主进程仅 `rpc`、`rpc.window` 两个 handle；新增业务能力 = daemon methods 表加方法，禁止开新通道。
2. **沙箱 fail-safe**：workspace 外默认只读；凭证目录（.ssh/.gnupg/.aws/keystore）三操作全 deny。规则改动必须带 T08 用例。
3. **凭证不落明文**：API Key 只进 CredentialVault（safeStorage 或 AES-256-GCM + 0600 keyfile）；T10 断言是红线。
4. **模式策略双保险**：ask/plan 的工具限制由 `engine/policy.js` 代码强制 + system 提示词；禁止删代码层只留提示。
5. **确认门控**：deny 规则直接拒；confirm 规则必须经 UI 批准（120s 超时默认拒绝），不得记忆批准结果。
6. **验收门槛**：`npm run verify` ALL GREEN 才算完成；任何 FAIL 必须归因（方案设计问题 / WorkBuddy 理解问题）并回改（流程见 design/99-test-plan.md）。
7. **无遥测外发**：本工具不内置任何数据上报（与 WorkBuddy aegis/galileo 的刻意偏离）。

## Agent 调查预算规则

- 渐进式研读：一批 3–4 个文件；单文件超 200 行用切片读取（Read offset/limit）。
- 复杂任务先产出提纲再动代码；改功能前先读 `design/` 对应文档（每份含「WorkBuddy 观察→复现设计→验证方法」；F19–F28 见 design/20–26）。
- 跑过 `npm run verify` 之前不要声称完成；报告以 `artifacts/acceptance-report.md` 为准（T01–T28）。
- 大模型相关调试用 `scripts/mock-llm.mjs`（脚本化响应），不要烧真实 API。

## 全局分级地图索引

| 层级 | 模块 | 入口 | 要点 |
|---|---|---|---|
| 根 | 本文件 + [CLAUDE.md](CLAUDE.md) + [GEMINI.md](GEMINI.md) | — | 命令/铁律/路由 |
| L1 | app/main | [AGENTS.md](app/main/AGENTS.md) | 窗口/托盘/deeplink/DaemonClient 重连/更新器（updater.js）/--share |
| L1 | app/daemon | [AGENTS.md](app/daemon/AGENTS.md) | 方法表/存储/沙箱/技能/搜索/终端/EngineHost/IM/市场/同步/A2A |
| L1 | app/engine | [AGENTS.md](app/engine/AGENTS.md) | 工具循环/policy/llm/tools（browser/cloud-sandbox/agent_delegate） |
| L1 | app/renderer | [AGENTS.md](app/renderer/AGENTS.md) | 四页面（主/设置/搜索/预览）+ 渲染管线（需 npm run build） |
| L2 | app/preload | [AGENTS.md](app/preload/AGENTS.md) | contextBridge 安全边界 |
| L2 | app/shared | — | preview-kind / browser-probe（daemon 与 engine 共用的纯逻辑） |
| L2 | design/ | [AGENTS.md](design/AGENTS.md) | 00-roadmap 功能点 SSOT |
| L2 | tests/ | [AGENTS.md](tests/AGENTS.md) | T 编号 = 验收映射（T01–T28） |
| L2 | scripts/ | [AGENTS.md](scripts/AGENTS.md) | build/verify/mock/real-llm + update/（更新过渡窗） |
| L2 | skills/ | [AGENTS.md](skills/AGENTS.md) | SKILL.md 格式规范 |
| L2 | market/claude-skills/ | design/35-claude-skill-market.md | 内置 Claude 技能市场（vendor 脚本生成，勿手改） |
| L2 | share-target/ | design/24-share-target.md | sparse MSIX + register/unregister 脚本 |
