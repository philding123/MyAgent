# MyAgent 验收报告

- 生成时间: 2026-10-17T15:05:08.637Z
- 单元测试: PASS (61 cases)
- 集成测试: PASS (63 cases)
- E2E 冒烟: PASS

| T | 功能点 | 结果 | 明细 |
|---|---|---|---|
| T01 | F01 多窗口 | PASS | ✓ e2e:main-window<br>✓ e2e:main-loaded<br>✓ e2e:multi-window (main,settings,search) |
| T02 | F02 守护进程+RPC | PASS | ✓ T02 codec roundtrip single frames<br>✓ T02 codec splits chunks across pushes<br>✓ T02 codec tolerates bad frames<br>✓ T02a daemon method roundtrip + unknown method + ready snapshot<br>✓ T02b DaemonClient restarts daemon after crash |
| T03 | F03 存储 | PASS | ✓ T03 json store DAO cases<br>✓ T03 sqlite store DAO cases<br>✓ T03 json store corrupt recovery<br>✓ T03 sqlite store corrupt recovery<br>✓ T03 json→sqlite migration absorbs an empty-db snapshot |
| T04 | F04 引擎 | PASS | ✓ T04a plain text reply streams token events<br>✓ T04b tool call loop writes the file<br>✓ T04c repeated engine.start re-pipes once — no duplicate events<br>✓ T04d failed run_command carries stderr detail for the UI |
| T05 | F05 预热池 | PASS | ✓ T05 pool maintains one idle when enabled<br>✓ T05 pool disabled keeps zero<br>✓ T05 unexpected idle exit triggers replenish<br>✓ T05 disable drains pool<br>✓ T05 re-pipe replaces the previous pipe listener |
| T06 | F06 工具集 | PASS | ✓ T06 write_file creates dirs + read_file numbered window<br>✓ T06 read_file sandbox denial outside workspace<br>✓ T06 list_dir formats entries<br>✓ T06 run_command executes and reports exit code<br>✓ T06 run_command timeout<br>✓ T06 search finds hits with line numbers<br>✓ T06 skill_read reads registry<br>✓ T06 tool definitions are OpenAI function-shaped<br>✓ T06 browser tool error summary strips ANSI escapes |
| T07 | F07 模式策略 | PASS | ✓ T07 ask mode blocks writes and commands (hard rules)<br>✓ T07 plan mode: read-only command allowed, writes need confirm<br>✓ T07 plan mode: write goes through confirm and denial stops it |
| T08 | F08 沙箱 | PASS | ✓ T08 credentials dir is fully denied (WorkBuddy tsbx parity)<br>✓ T08 temp + workspace allowed for all ops<br>✓ T08 outside workspace defaults to read-only (fail-safe)<br>✓ T08 ** crosses segments, * stays within one<br>✓ T08 command rules deny/confirm/allow<br>✓ T08 default rules protect .ssh and keystore |
| T09 | F09 确认门控 | PASS | ✓ T09a sandbox deny pattern blocks rm -rf without confirm<br>✓ T09b confirm pattern asks, denial stops execution<br>✓ T09c approved confirm executes the command |
| T10 | F10 凭证保护 | PASS | ✓ T10 vault roundtrip without plaintext on disk<br>✓ T10 vault delete |
| T11 | F11 技能系统 | PASS | ✓ T11 frontmatter parses WorkBuddy-style SKILL.md<br>✓ T11 frontmatter tolerates missing fields<br>✓ T11 scanSkillDir reads builtin sample<br>✓ T11 registry scan/toggle with builtin + user dirs<br>✓ T11 disable:true excluded from enabled<br>✓ T11b enabled skills appear in engine system prompt; skill_read works |
| T12 | F12 本地市场 | PASS | ✓ T12c builtin evidence-check skill is scanned and readable (skill-parity method)<br>✓ T12a install from directory, list, uninstall<br>✓ T12b install from zip (PowerShell Expand-Archive) |
| T13 | F13 记忆 | PASS | ✓ T13 preference reaches the LLM system message and deletion removes it<br>✓ T13 fact kind also injects |
| T14 | F14 终端 | PASS | ✓ T14 terminal echo roundtrip |
| T15 | F15 全局搜索 | PASS | ✓ T15 message + file hits with locators |
| T16 | F16 托盘/Deeplink | PASS | ✓ e2e:deeplink-consumed ([{"action":"session","id":"aa7a3467-1e64-472d-82f8-00dca17af326"}])<br>✓ e2e:tray |
| T17 | F17 渲染管线 | PASS | ✓ e2e:render-sanitize ({"pwned":false,"html":"<p>&lt;img src=x onerror=window.__pwned=1&gt;</p>\n"}) |
| T18 | F18 设置/自检 | PASS | ✓ T18a selfcheck reports capability matrix<br>✓ e2e:selfcheck (sqlite)<br>✓ e2e:preload-bridge (pong) |
| T19 | F19 mermaid 渲染 | PASS | ✓ e2e:mermaid-render ({"svg":true,"errors":0}) |
| T20 | F20 文档预览 | PASS | ✓ T20a extractMermaidBlocks finds mermaid fences only<br>✓ T20a pickPreviewKind maps office/image/text families<br>✓ e2e:preview-readbinary (text/plain)<br>✓ e2e:preview-window ({"path":"D:\\Proj\\ai_workspace\\myagent\\tests\\fixtures\\share-sample.txt","kind":"text","ok":true,"error":null,"bytes":20}) |
| T21 | F21 自动更新器 | PASS | ✓ T21a compareSemver ordering<br>✓ T21a updater: malformed manifest -> error not throw<br>✓ T21a updater: missing manifest fields rejected<br>✓ T21a updater: sha256 mismatch deletes the artifact<br>✓ T21a updater: apply refuses when nothing ready<br>✓ T21b check→download→verify→ready with progress stages<br>✓ T21b corrupt artifact is refused and cleaned<br>✓ T21b unavailable source -> disabled/error states<br>✓ e2e:updater-status ({"enabled":false,"stage":"idle","v":"0.1.0"}) |
| T22 | F22 Browser-use | PASS | ✓ T22a action kinds: read vs exec split is design-true<br>✓ T22a foreign ref rejected before any browser launch<br>✓ T22b navigate→content→snapshot→click→screenshot flow<br>✓ T22b unknown action and stale ref are value-errors, not throws<br>✓ e2e:browser-tool (msedge/true) |
| T23 | F23 IM 通道 | PASS | ✓ T23a RingDedup keeps newest 500, drops duplicates<br>✓ T23a telegram token validation<br>✓ T23a markdown -> telegram html covers headings/bold/code/links<br>✓ T23a splitHtml chunks without cutting tags and stays under limit<br>✓ T23b full loop: valid token -> inbound -> dedup -> outbound reply<br>✓ T23b oversized reply is chunked into multiple sendMessage calls<br>✓ T23b invalid token -> AUTH_FAILED nonRecoverable<br>✓ T23b getMe 401 -> AUTH_FAILED; 5 network failures -> RECONNECT_EXHAUSTED<br>✓ T23c ChannelManager states: needs_credentials -> configured; status table<br>✓ e2e:im-status (telegram,webhook,slack,discord,dingtalk,feishu) |
| T24 | F24 分享目标 | PASS | ✓ T24a AppxManifest.xml is well-formed with ShareTarget extension<br>✓ T24a register/unregister ps1 parse cleanly<br>✓ T24a register.ps1 keeps the evidence-grade engineering details<br>✓ e2e:share-argv (Shared: share-sample.txt) |
| T25 | F25 云端市场 | PASS | ✓ T25a keywordsMatch requires all keywords (1-5)<br>✓ T25a market refuses plain http unless allowInsecure<br>✓ T25 search/install/already/refused(hash) through daemon RPC<br>✓ e2e:market-status |
| T26 | F26 端云同步 | PASS | ✓ T26a SyncTargetDirectory put/get/list roundtrip<br>✓ T26 two daemons sync through a shared directory target<br>✓ T26 rev conflict preserves both sides (store-level)<br>✓ e2e:sync-status |
| T27 | F27 云沙箱 | PASS | ✓ T27 fs/exec roundtrip on the cloud backend<br>✓ T27 401 triggers exactly one shared reconnect then succeeds<br>✓ T27 concurrent auth failures share one reconnect attempt<br>✓ T27 reconnect throttle: second auth error within 10s fails closed<br>✓ T27 tool layer routes through the cloud backend<br>✓ e2e:phase4-fields |
| T28 | F28 A2A 协作 | PASS | ✓ T28 agentCard has A2A-required fields<br>✓ T28 message/send roundtrip + delegate client + card shape<br>✓ T28 delegate reports unreachable agent as a value error<br>✓ e2e:a2a-card (MyAgent) |
| T29 | F29-F33 像素级 UI（WorkBuddy 复刻，排除支付） | PASS | ✓ e2e:ui-token ({"brand":"#00c29a","side":360,"band":30})<br>✓ e2e:ui-shell ({"brand":"#00c29a","side":360,"band":30})<br>✓ e2e:ui-main ({"top":64,"heroOk":true})<br>✓ e2e:ui-settings (224)<br>✓ e2e:ui-search ([800,640,42])<br>✓ e2e:ui-preview ([980,720,32,"rgb(242, 242, 242)"])<br>✓ e2e:ui-token-dark ({"attr":"dark","brand":"#4ecba0","content":"#1a1a1a","side":"#1f1f1f","gray2":"#292929"})<br>✓ e2e:ui-paywall-zero |
| T30 | F34 MCP 服务面 | PASS | ✓ T30 initialize handshake returns protocol version + server info<br>✓ T30 notifications return null (no response frame)<br>✓ T30 tools/list exposes the four minimal tools<br>✓ T30 tools/call sessions_list returns the seeded session<br>✓ T30 tools/call search_query finds the seeded message<br>✓ T30 tools/call with unknown tool fails -32602<br>✓ T30 resources/read round-trips the seeded session<br>✓ T30 unknown method fails -32601; invalid request fails -32600<br>✓ e2e:mcp-status ({"start":{"running":true,"pid":37372},"run":{"running":true,"pid":37372}}) |
| T31 | F35 原生菜单最小面 | PASS | ✓ e2e:menu ({"accelerator":"CmdOrCtrl+N","menuState":{"home":true,"count":0},"before":85,"after":85}) |
| T32 | F36 启动画面 splash | PASS | ✓ e2e:splash-handoff ({"created":true,"closed":true}) |
| T33 | F39 空间 | PASS | ✓ T33 space field persists and groups sessions |
| T34 | F40 定时任务 | PASS | ✓ T34 scheduler fires on interval and honors remove<br>✓ T34 scheduler disabled schedule does not fire |
| T35 | F41 预设（助理） | PASS | ✓ T35 preset store CRUD |
| T36 | F42 资料库 | PASS | ✓ T36 library tools list and read inside the library dir |
| T37 | F43 @ 上下文 | PASS | ✓ T37 augmentContext inlines files and keeps unreadable notes |
| T38 | F46 web_search/web_fetch 检索 | PASS | ✓ T38 bing SERP parser extracts title/url/snippet<br>✓ T38 htmlToText strips script/style and decodes entities<br>✓ T38 web_search uses cn.bing.com with encoded query (injected fetch)<br>✓ T38 web_search HTTP error and transport failure are values<br>✓ T38 web_fetch strips html over real localhost and caps chars |
| T39 | F47 present_file 交付 | PASS | ✓ T39 present_file copies into the delivery stamp folder<br>✓ T39 present_file refuses outside-workspace and missing files<br>✓ T39b present_file tool_result carries artifact info |
| T40 | F45 任务步数预算与续跑 | PASS | ✓ T40 engine.maxSteps bounds the loop and stays continuable |
| T41 | F48/F49 计划卡与进度用量 | PASS | ✓ T41 todo events + step fields + usageTokens on done |
| T42 | F50 上下文自动压缩 | PASS | ✓ T42 small history is untouched<br>✓ T42 compaction keeps system+goal+recent groups with complete pairs<br>✓ T42b compaction bounds real daemon requests on tool-heavy tasks |
| T43 | F51 会话消息落库 | PASS | ✓ T43 assistant and tool messages persist for reopen (D10) |
| T44 | F44 产物卡片与运行反馈面（渲染层） | PASS | ✓ e2e:ui-tool-surfaces ({"art":true,"progOk":true,"rows":2,"doneRow":true,"merged":true,"progHidden":true,"usage":true}) |

## 降级记录
- Electron 运行时 store 模式: sqlite