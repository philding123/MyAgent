# 45 — 对标 Octop 的五项补齐路线（F61–F65）

> 状态：📋 规划（2026-10-30）。来源：与腾讯云开源 [TencentCloud/Octop](https://github.com/TencentCloud/Octop)
> （MIT，多用户自托管 AI 工作台）的功能点对比。MyAgent 定位不变——**个人桌面工作台**；
> Octop 的多用户/服务端部署/云端协作**不在本路线内**（与个人定位冲突，见 §8）。
> 本文是路线总纲；每项开工前按惯例拆出独立设计文档（46–50），并先改 00-roadmap。

## 1. 选题依据

| 差距（Octop 有、MyAgent 无） | 对个人桌面用户的价值 | 入选 |
|---|---|---|
| 每个专家独立模型/供应商 | 高：写作用大模型、杂活用便宜/本地模型 | ✅ F61 |
| 资料库语义检索（RAG） | 高：资料库目前只能 list/read，大文档用不上 | ✅ F62 |
| 国内 IM 通道（飞书/钉钉/企业微信） | 中高：手机上随时派活；现只有 Telegram 完整 | ✅ F63 |
| 委派编码代理（Claude Code / Codex / OpenCode） | 高：代码任务交给专业代理，MyAgent 做编排 | ✅ F64 |
| cron + 对话式建定时任务 + 结果推送 | 中高：现只有「每 N 分钟」且只能在设置里建 | ✅ F65 |
| 多用户 / Web 控制台 / Docker / 服务化 | 低（个人桌面） | ❌ §8 |
| AgentTeams 协调者 | 中，但依赖 F61+F64 先落地 | ⏭ 后续 |
| OAuth 连接器目录 | 中，F52 MCP 已可手接 | ⏭ 后续 |
| PII 脱敏 | 中 | ⏭ 后续 |

## 2. 里程碑

| 版本 | 内容 | 规模 | 依赖 |
|---|---|---|---|
| v0.4.0 | **F61** 专家独立模型 + **F65** cron/对话式定时任务（推送先走系统通知） | S + M | — |
| v0.5.0 | **F62** 资料库语义检索 + **F64** 编码代理委派 | M + M | F61（嵌入模型走模型档案） |
| v0.6.0 | **F63** 飞书/钉钉/企业微信完整通道 + F65 结果推送到 IM | L | 需真实租户凭证做手工联调 |

每个里程碑的完成定义不变：`npm run verify` ALL GREEN，新 T 编号进验收报告，按钮审计覆盖新控件。

---

## 3. F61 专家独立模型配置（模型档案）

**现状**：全局只有一套 `llm.baseUrl / llm.apiKey / llm.model`（daemon `buildInit`）；预设（F41）只是系统提示。

**设计**
- 新增「模型档案」`modelProfiles`：`{id, name, baseUrl, model, contextChars?, vision?: bool}`，存 settings KV
  `models.profile.<id>`；API Key 只进 vault，键 `llm.profile.<id>.apiKey`。
  `VAULT_KEYS` 从固定集合改为「固定集合 + `llm.profile.*.apiKey` 前缀」判定（T10 无明文断言扩到档案）。
- 现有三件套迁移为内置档案 `default`（启动迁移，行为不变）。
- 预设增加 `modelProfile` 字段；会话也可单独覆盖（`sessions.setModel`）。解析优先级：
  会话覆盖 → 绑定预设 → `default`。`buildInit` 按解析结果下发；切换即停引擎、下一条消息带新模型重启（与模式切换同一路径）。
- RPC：`models.list / models.save / models.remove / models.test`（`models.test` 复用 `memory.test.llm` 的连通性探测）。
- UI：设置「模型」面板改为档案列表 + 编辑表单；专家卡片与 composer 的模型 chip 显示当前档案，点击可切换。
- F59 视觉回路读档案的 `vision` 标记：不支持图像的档案下截图直接返回诚实错误值，不发 image_url。

**验证（T57）**：档案 CRUD 与 vault 无明文（json/sqlite 双存储参数化）；旧三件套迁移；优先级解析；
mock LLM 断言不同预设的会话打到不同 model 字段；按钮审计加「切换会话模型」。

**风险**：key 迁移失败会让用户断连 → 迁移幂等且保留原键直到首次成功调用。

## 4. F62 资料库语义检索（RAG）

**现状**：F42 资料库只有 `library_list / library_read`，长文档整篇塞进上下文或干脆用不上。

**设计**
- **切块**：按标题/段落切 ~800 字符块，带 `{file, sha256, offset, heading}`；文本抽取复用预览管线
  （`app/shared/preview-kind.js` 与 docx/pdf/xlsx 抽取器），不新增原生依赖。
- **两级检索，离线可用**：
  1. 关键词：BM25 倒排索引（sqlite 用 FTS5，json store 用同接口的纯 JS 倒排）——**双存储同 DAO**，T03 式参数化测试；
  2. 向量（可选）：档案若配置 embedding 模型（OpenAI 兼容 `/embeddings`，F61 档案 `kind: embedding`），
     向量存同表，查询时 BM25 与余弦分数做 RRF 融合。无 embedding 档案时只用 BM25，功能不降为不可用。
- **增量索引**：按文件 sha256 判定；`library.add/remove` 触发；大文件后台分批，进度事件 `library:index`。
- **引擎工具** `library_search {query, k≤8}` → 返回块文本 + 出处；系统提示要求引用出处，渲染层把
  `[资料库: 文件名 §标题]` 渲染为可点开预览的引用 chip。
- 本地 ONNX 嵌入模型列为后续（原生依赖 + 体积，需单独评估）。

**验证（T58）**：切块边界与出处；BM25 排序（固定语料金标准）；双存储一致；有/无 embedding 档案两条路径
（mock `/embeddings`）；增量索引只重算变更文件；引擎端到端：mock 模型调 `library_search` 后答案带引用。

## 5. F63 飞书 / 钉钉 / 企业微信 完整通道

**现状**：F23 只有 Telegram 完整实现；飞书/钉钉为骨架（凭证校验 + 状态机，不连网）；无企业微信。

**设计**
- 沿用 F23 通道插件契约 `{id, meta, capabilities, gateway, outbound, defaultReplyPolicy}`、500 环形去重、
  vault `im.<channel>.token`，只把骨架换成真实实现：
  - **飞书**：长连接模式（官方 WS，免公网回调）收 `im.message.receive_v1`；发消息走 OpenAPI，`tenant_access_token` 自动续期。
  - **钉钉**：Stream 模式（免公网回调）收机器人消息；回复走 `sessionWebhook`，主动推送走机器人 OpenAPI。
  - **企业微信**：智能机器人长连接（若租户不支持则回落「应用消息 + 回调」，回调需公网，文档标注手工步骤）。
- 群聊：仅 @机器人 或私聊触发（`defaultReplyPolicy.mode: mention`），会话按 `channel:chatId` 映射到 MyAgent 会话。
- 安全：入站消息一律走 ask 模式起步，用户在桌面端对该会话显式提权才可写/执行（与 F07 双保险一致）；
  白名单（用户 ID）可选。
- 协议实现优先用官方开放协议直连；若必须引入官方 SDK，按「依赖走 esbuild/daemon、不进渲染层」约束。

**验证（T59）**：每个通道一套本地 mock 服务器（WS + REST）跑完整回路：鉴权 → 入站 → 去重 → 引擎回复 →
出站分片；token 过期续期；断线退避；群聊 @ 策略。真实租户联调列为手工项（同 F23 惯例），结果记入验收报告降级记录。

**风险**：各平台协议变动 / 企业微信长连接开放范围 → 每个通道独立开关，失败不影响其他通道。

## 6. F64 编码代理委派（Claude Code / Codex / OpenCode）

**现状**：`agent_delegate` 只支持 A2A HTTP 代理；不能把编码任务交给本机的专业编码 CLI。

**设计**
- 新引擎工具 `coding_delegate {agent: 'claude-code'|'codex'|'opencode', task, cwd?, timeoutSec?}`：
  - 以无头模式运行本机 CLI（`claude -p --output-format stream-json`、`codex exec --json`、`opencode run`），
    **cwd 必须在会话工作空间内**（沙箱判定），环境变量白名单透传；
  - `kindOf` = exec → ask/plan 拒绝；craft 下仍走确认门控（显示代理名 + 任务摘要）；
  - 流式输出转为 `tool_progress` 事件，渲染层工具卡片实时显示；abort 链路可中断（树杀，Windows 用 `taskkill /T /F`）；
  - 结束后汇总：退出码、改动文件列表（`git status --porcelain` 若为仓库），改动文件进 F58 快照，可一键回滚。
- `app.selfcheck` 增加 `codingAgents: {claude-code, codex, opencode}` 探测（PATH 查找 + `--version`），未安装的不注册到工具描述里。
- 二期（不在本里程碑）：ACP 入站——把 MyAgent 作为 ACP agent 暴露给 Zed 等编辑器。

**验证（T60）**：用假 CLI（node 脚本模拟三种输出格式）测：参数构造、stream 解析、cwd 沙箱拒绝、超时/abort
树杀、ask/plan 拒绝、改动文件进快照；selfcheck 探测。真实 CLI 联调为手工项。

## 7. F65 cron 与对话式定时任务

**现状**：F40 调度器只有 `intervalMs`；只能在设置页创建；结果只进会话。

**设计**
- 调度器支持 `cron`（5 字段 + 时区，`@daily` 等别名）与 `intervalMs` 并存（旧数据不迁移即可用）；
  内置轻量 cron 解析与 `nextAt` 计算（无新依赖），处理 DST 与错过窗口（关机期间错过的只补跑最近一次）。
- 新引擎工具 `schedule {action: create|list|remove|toggle, name, prompt, cron?|every?, deliver?}`：
  create/remove/toggle 归 exec（ask/plan 拒绝、需确认，确认条展示「下次运行时间」的人话描述）。
  用户说「每个工作日早上 9 点总结昨天的邮件」→ 模型产出 `cron: "0 9 * * 1-5"`，daemon 回显人话校验。
- 结果投递 `deliver`：`session`（默认）/ `notify`（系统通知，点开跳会话）/ `im:<channel>:<chatId>`（依赖 F63，v0.6.0 打开）。
- UI：定时任务面板显示 cron 人话描述、下次运行、上次结果状态；侧栏「定时任务」入口直达。

**验证（T61）**：cron 解析与 nextAt（含边界：月末、闰年、DST、步长/范围/列表）；interval 旧数据兼容；
错过窗口补跑一次；`schedule` 工具的模式门控与确认；投递到 notify（主进程通知接缝记录）；按钮审计覆盖面板。

## 8. 明确不做（与个人定位冲突）

多用户 JWT 登录与隔离、Web 控制台/HTTP API 远程访问、Docker/systemd 服务化部署、PostgreSQL/S3 工作空间后端、
跨实例专家协作。若未来需要「手机远程用」，优先走 F63 IM 通道而不是开放网络端口（保持无对外监听的安全姿态）。
