# 26 · 端云同步 / 云沙箱 / 多 Agent 协作（F26 / F27 / F28）

> Phase-4 三项，均为"开放协议 + 可本地验证"形态：同步走目录/WebDAV，
> 云沙箱走 e2b 兼容 HTTP 适配器（mock 验证），多 agent 走 A2A 开放协议。

## WorkBuddy 观察（证据）

| 证据 | 路径（逆向基线） | 结论 |
|---|---|---|
| `resources/extensions/edge-sync/extension.json`（app.asar.unpacked 直读） | `"端云一体同步 —— 把本地 Conversation 事件推到云端 + 云端指令下发到本地"`；`service:{entry:'./server/index.cjs', process:'fork', activationEvents:['onStartup']}` | Edge Sync：事件推送 + 指令下发，fork 常驻服务 |
| `main/e2b-filesystem.js`（app.asar 提取，可读） | `Sandbox.connect(sandboxId,{domain, apiUrl, requestTimeoutMs, debug, headers})`；fs 接口 `read/write/list/exists/makeDir/remove/rename/getInfo/watchDir`；**401/403/鉴权错误 → 重连，最小间隔 10s**（`MIN_RECONNECT_INTERVAL_MS`），重连去重（并发订阅同一结果） | 云沙箱文件面接口与重连语义 |
| 90-deferred.md | `@a2a-js/sdk`、experts/teams | 多 agent = A2A 协议 |

## 复现设计

### F26 端云同步（Edge Sync 替代）

- 模块：`app/daemon/sync.js`（daemon 进程内；个人版不做独立 fork 服务——daemon 即常驻）。
- 目标后端：`directory`（本地/网盘同步目录）与 `webdav`（PUT/GET/MKCOL + Basic 认证，
  密码入 vault）。两者共享同一存储布局：
  `<target>/myagent-sync/sessions/<id>.json` = `{session, messages, rev, updatedAt}`。
- 行为：
  - `push()`：自上次同步后有变更（内存 dirty 标记 + rev 自增）的会话整体导出写入
    （对齐"Conversation 事件推到云端"的最小等价：按会话粒度快照 + rev）；
  - `pull()`：远端 rev 较新 → 覆盖本地；冲突（双方都新）→ 远端另存 `<id>.conflict.json`，不丢数据；
  - 自动模式 `sync.auto=true`：`sessions.appendMessage` 后 debounce 5s 推送（对齐 onStartup 常驻语义）；
  - `sync.status`：`{target, auto, lastPush, lastPull, dirty, lastError}`。
- RPC：`sync.configure {target:'directory'|'webdav', …}` / `sync.push` / `sync.pull` / `sync.status`。
- "云端指令下发"等价物：pull 下来的远端会话即刻出现在会话列表（`daemon:ready`/广播刷新）。

### F27 云沙箱（e2b 兼容适配器）

- 模块：`app/engine/cloud-sandbox.js`。
- 接口（对齐证据 fs 面 + 命令面）：`read/write/list/exists/remove/makeDir/exec`；
  settings：`sandbox.backend: 'local'|'cloud'`、`sandbox.cloud.url`、`sandbox.cloud.sandboxId`、
  vault 键 `sandbox.cloud.apiKey`。
- cloud 后端：HTTP 到 e2b 兼容端点（`/files/*`、`/commands/run`）；
  鉴权错误（401/403）→ 单次重连（`GET /sandboxes/<id>/connect` 类刷新），**最小间隔 10s**，
  并发重连共享同一 Promise（照抄证据语义）；重连失败 → 工具返回 `ok:false`（fail-closed）。
- 工具接入：`read_file/write_file/list_dir/run_command` 在 cloud 后端走适配器
  （云内隔离，不再叠加本地沙箱路径检查——隔离责任转移到云端，与 WorkBuddy e2b-filesystem 直连 sandbox.files 一致）；
  `search/skill_read` 保持本地（技能与索引在宿主）。
- 引擎 init 增加 `sandbox.backend` 上报；`app.selfcheck` 增加对应字段。

### F28 多 Agent 协作（A2A）

- 模块：`app/daemon/a2a.js` + 引擎工具 `agent_delegate`。
- 服务端（本机即 agent）：`a2a.enabled=true` 时 daemon 起 HTTP 服务（127.0.0.1，settings `a2a.port` 默认 41239）：
  - `GET /.well-known/agent.json` → AgentCard `{name, description, url, version,
    capabilities:{streaming:false}, defaultInputModes/OutputModes:['text/plain'], skills:[{id:'chat',…}]}`；
  - `POST /` JSON-RPC `message/send`，params `{message:{role:'user', parts:[{kind:'text', text}]}}`
    → 复用 A2A 专用会话（`A2A/<client>` 标题）跑引擎 → 返回
    `{role:'agent', parts:[{kind:'text', text:<最后 assistant 消息>}], messageId}`。
- 客户端：引擎工具 `agent_delegate {url, message}`（kind read——委派是外部询问，
  结果只进上下文）：fetch AgentCard → POST `message/send`（120s 超时）→ 返回文本。
  由此形成"本机 MyAgent ↔ 远端 A2A agent"互操作闭环（个人用最小面，
  不实现 streaming/task 生命周期扩展，记为后续）。

## 验证方法

| 层 | 断言 |
|---|---|
| int T26 | 目录目标：两实例（两 MYAGENT_HOME）对同一同步目录 push/pull → 会话互通；rev 冲突产生 `.conflict.json` 且无数据丢失；webdav 后端用内置 mini-DAV 测试服务验证同断言 |
| int T27 | mock e2b HTTP 服务：write/read/list/exec 往返；401 → 触发一次重连刷新 → 成功；连续 401 → fail-closed；10s 内并发第二次 401 不重复发刷新请求（计数断言） |
| int T28 | daemon 起 a2a 服务 → 本机 `message/send`（mock LLM）返回 agent 文本；`agent_delegate` 指向自身 card 闭环返回；card 字段齐全 |
| e2e T26–T28（冒烟步 `sync-status`/`cloud-sandbox-field`/`a2a-card`） | selfcheck/status 字段齐全；a2a card HTTP 200 且 JSON 可解析（mock LLM，不外联） |
| 手工 | 真实 e2b 账号（如有）跑一次云内命令；两台机器目录同步 |

## 降级路径

- `sandbox.backend` 缺省 local，一切现状不变；cloud 后端错误一律 `ok:false` 文本化。
- a2a.enabled=false（默认）：端口不开，零监听。
