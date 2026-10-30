# 46 — 执行轨迹与审计（F66）

> 状态：实施中（2026-10-30）。用户诉求：代理交付产物后，能回看「它为此做了什么」——
> 每一步模型调用、每个工具调用及参数、策略判定与人工批准、产物的哈希——用于审计。

## 1. 现状缺口

| 已有 | 缺什么 |
|---|---|
| F51 消息落库：assistant 文本、tool 摘要 | 工具**参数**、步序、耗时、模型/模式不落库 |
| F44/F55 产物登记：路径 + 来源工具 | 不知道产物由哪一轮、哪几步产生；无内容哈希 |
| F58 文件快照 | 与执行步骤无关联 |
| 确认条（F09） | 批准/拒绝/超时结果不留痕 |

## 2. 设计

### 2.1 轨迹存储（`app/daemon/trace.js`）

- 每会话一个**追加写** JSONL：`MYAGENT_HOME/traces/<sessionId>.jsonl`（不进 sessions/messages DAO：
  审计日志只追加、按会话整文件删除；与 F58 同口径的文件布局裁决，双存储实现不受影响）。
- **哈希链防篡改**：每条记录 `hash = sha256(prevHash + canonicalJSON(记录去掉 hash))`，首条 prev 为 64 个 `0`。
  `trace.verify` 逐条重算，报告首个断链位置（被改、被删、被插都能发现）。
- 记录公共字段：`{seq, ts, turn, kind, …, prev, hash}`；`turn` 由 daemon 分配（每次用户消息 +1）。
- 体积护栏：单字段截断（参数 2000 字符、摘要 500、回复摘录 1000），超出标 `truncated:true`；
  单会话文件上限 20MB，超限写一条 `kind:'limit'` 后停止追加（不静默丢）。
- **脱敏**：写入前对所有字符串做替换——vault 中的真实密钥值（`llm.apiKey`、云沙箱 key、IM token）
  与常见形态（`sk-…`、`Bearer …`、`ghp_…`、`xox[bp]-…`、`AKIA…`）→ `[REDACTED]`。
- 设置 `trace.enable`（默认开，纯本地，零外发——不变式 #7 不受影响）。删除会话时同步删除其轨迹。

### 2.2 记录类型

| kind | 产生方 | 关键字段 |
|---|---|---|
| `turn_start` | daemon（engine.userMessage / IM 入站 / 定时任务） | `source: user\|schedule\|im`，`prompt`（摘录）+ `promptSha`，`mode`，`model`，`preset` |
| `llm_step` | 引擎新事件 | `step`，`ms`，`tokens`，`toolCalls`（本步请求的工具数） |
| `tool_call` | 引擎 tool_call（扩字段） | `id`，`name`，`kind: read\|write\|exec`，`args`（脱敏+截断），`step` |
| `confirm` | 引擎 confirm_request + 结果 | `id`，`describe`，`outcome: approved\|denied\|timeout` |
| `tool_result` | 引擎 tool_result（扩字段） | `id`，`name`，`ok`，`ms`，`policy: allow\|confirmed\|blocked\|denied\|timeout`，`summary`，`artifact?: {path, sha256, size, snapshot}` |
| `turn_end` | 引擎 done/error | `reason`，`ms`，`tokens`，`reply`（摘录）+ `replySha`，`artifacts: [path]` |

产物哈希由 **daemon** 在 tool_result 时对磁盘文件计算（≤50MB，超限记 `sha256:null, skipped:'too_large'`），
并关联 F58 快照版本号——审计时可证明「交付的就是这份字节」，且能一键恢复到那一版。

### 2.3 引擎改动（契约扩展，非破坏）

- 新 stdout 事件 `llm_step {step, ms, tokens, toolCalls}`（渲染层忽略未知类型）。
- `tool_call` 增 `kind`；`tool_result` 增 `ms`、`policy`；确认超时不再静默：`askConfirm` 区分 `timeout` 与 `denied`。

### 2.4 RPC（daemon methods 表，窄 IPC 不变）

| 方法 | 返回 |
|---|---|
| `trace.list {sessionId}` | 每轮摘要：`turn, startedAt, endedAt, source, prompt, reason, steps, tools, artifacts` |
| `trace.get {sessionId, turn?}` | 该轮（或全部）记录 |
| `trace.forArtifact {sessionId, path}` | 最近一次交付该路径的那一轮：`{turn, records}` |
| `trace.verify {sessionId}` | `{ok, count, brokenAt?}` |
| `trace.export {sessionId, turn?, format: md\|json}` | `{filename, content}`：Markdown 审计报告（步骤表 + 产物哈希 + 链校验结果）或原始 JSON |

### 2.5 UI

- 产物面板新增按钮「执行轨迹」：打开所选产物那一轮的时间线（与「历史版本」同一预览区）：
  - 头部：轮次、来源、模式/模型、耗时、token、**链校验徽标**（✓ 完整 / ✗ 第 N 条起被改动）；
  - 时间线：每步一行——时间、步号、模型调用耗时；工具名 + 种类标签 + 参数摘要（可展开全文）+ 策略判定 + 结果；
    命中该产物的那一步高亮；
  - 轮次切换（上一轮/下一轮）、「导出 Markdown」「导出 JSON」。

## 3. 验证（T62）

- unit：哈希链追加与校验（改字段/删行/插行均被发现）；脱敏（vault 值 + 形态）；截断标记；20MB 上限写 limit；
  `forArtifact` 选中最近交付轮；Markdown 导出包含步骤与产物 sha256。
- integration：真实 daemon + mock LLM 跑「list_dir → write_file → present_file」一轮：轨迹含 turn_start/llm_step×N/
  tool_call(args)/tool_result(ms, policy, artifact sha256 = 磁盘文件实际哈希)/turn_end；plan 模式写入走确认 →
  `confirm.outcome` 与 `policy: confirmed|denied` 正确；`trace.verify` ok；删除会话轨迹文件随之删除。
- e2e/审计：产物面板「执行轨迹」按钮打开时间线、高亮交付步、导出产生文件（T49 新增控件）。
