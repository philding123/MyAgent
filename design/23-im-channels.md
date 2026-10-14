# 23 · IM 通道（F23）

> Phase-2/3。把消息平台接入引擎：入站消息 → 会话 → 引擎回复 → 出站发送。
> 协议公开平台可全自动验证（mock 传输层）；真实 token 接入为手工项。

## WorkBuddy 观察（证据）

| 证据 | 路径（逆向基线） | 结论 |
|---|---|---|
| `main/telegram.js`（11.4KB，app.asar 提取，可读） | `createTelegramPlugin(env)` 返回 `{id:'telegram', meta:{displayName, transport:'long-poll'}, capabilities:{sendText,sendMarkdown,sendMedia,interactive,streaming,groupChat,threading}, config, gateway, outbound, defaultReplyPolicy:{mode:'all'}}` | **插件契约**（六件套） |
| 同上 gateway 部分 | `getMe` 启动校验（401→`AUTH_FAILED nonRecoverable`）；`getUpdates?timeout=30&offset=` 长轮询 + offset 推进；连续 5 次失败 → `RECONNECT_EXHAUSTED nonRecoverable`，失败间隔 5s 重试 | 网关生命周期语义 |
| 同上 inbound | `{messageId, content:[{type:text\|image\|file,…}], sender:{senderId,senderName}, group?, timestamp, replyContext:{chatId,messageId}}` | 入站消息形状 |
| 同上 outbound | Markdown→HTML 转换、**4000 字符分块**（HTML tag 感知切割）、400 时整块退化为纯文本重发 | 出站发送语义 |
| 90-deferred.md（原逆向记录） | 每平台一主进程模块；`recordMsgId` **500 条环形队列去重**；slack 用 socket-mode、dingtalk 用 stream、feishu 用 lark | 去重设计与各平台传输形态 |
| `resources/extensions/im-channels/extension.json` | `service:{process:'fork', activationEvents:['onHostReady']}` | IM 服务为宿主 fork 的常驻服务 |

## 复现设计

- 模块：`app/daemon/im.js`（ChannelManager，daemon 进程内；daemon 本就是宿主 fork 的常驻服务）+
  `app/daemon/im-channels/*.js`（每平台一文件）。
- 插件契约照搬六件套：`{id, meta, capabilities, gateway, outbound, defaultReplyPolicy}`；
  gateway/outbound 依赖注入 `fetchImpl`（测试换 mock）、`log`。
- 去重：`RingDedup(500)`——`recordMsgId` 环形缓冲，命中即丢弃
  （WorkBuddy 同参数；防止平台重推导致的重复回复）。
- 平台实现：
  - **telegram**：完整复刻（fetch 长轮询；token 形如 `\d+:[A-Za-z0-9_-]+` 校验；
    getMe 校验；offset 推进；5 连败 exhaustion；出站 4000 分块 + 纯文本回退）。
  - **slack（socket-mode）/ discord（gateway WS）/ dingtalk（stream）/ feishu（WS 长连接）**：
    本轮提供适配器骨架——凭证校验（缺 token → `needs_credentials` 状态）、
    状态机（disconnected/connecting/connected/error/exhausted）、
    传输接口定义与文档（真 token 为手工项，注明各平台申请入口）。
    协议报文解析/回复封装按各家公开文档实现到"可单元测试"程度。
  - **webhook（通用）**：入站 HTTP 小服务（127.0.0.1 固定端口 + 共享密钥头），
    个人自接任意平台（如企业微信应用回调），验证全自动。
- 引擎桥接：`channel:<id>:<chatId>` → 会话（复用现有 session；首条入站自动建会话，
  标题 `IM/<channel>/<chat>`）→ `engine.userMessage` → `done` 取最后 assistant 文本 →
  `outbound.send({deliveryMode:'final', text, replyContext})`。
  `defaultReplyPolicy.mode`: `all`（私聊+群）/ `direct`（仅私聊）。
- RPC：`im.status`（每通道连接态+凭证态）/ `im.start {channel}` / `im.stop {channel}` /
  `im.setCredential {channel, token}`（入 vault 键 `im.<channel>.token`，不落明文，红线 T10 同规）。
- 凭证安全：token 只存 vault；`im.status` 返回脱敏（前 4 后 4）。

## 验证方法

| 层 | 断言 |
|---|---|
| unit T23a | RingDedup：>500 淘汰最旧；重复 id 丢弃；telegram token 正则；出站 4000 分块边界（tag 不切半）与纯文本回退 |
| int T23b | mock Telegram Bot API HTTP 服务（脚本化 getMe/getUpdates/sendMessage）：启动→校验→注入 2 条 updates（含 1 条重复 id）→ 引擎（mock LLM）回复→ 断言 sendMessage 调用体与次数；401 → AUTH_FAILED；连续 5 次网络错 → exhausted |
| int T23c | 其余通道状态机：无凭证 → needs_credentials；setCredential 后 → connecting |
| e2e T23（冒烟步 `im-status`） | `im.status` 返回通道表，telegram 默认 disabled 且字段齐全 |
| 手工 | 填真实 Telegram bot token，手机发消息收回复；其余平台按文档逐一接 token |

## 降级路径

- 无任何凭证：全部通道 `disabled`，不影响其余功能。
- slack/discord/dingtalk/feishu 真连需 WS 依赖（`ws`）：作为依赖引入，
  骨架阶段不打开连接（避免无人值守挂 WS）。
