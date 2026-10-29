# 99 · 测试与验收计划

> 每个 T 编号对应 00-roadmap 的功能点。三层：unit（node --test，无 Electron）、
> integration（真实子进程 daemon/engine + mock LLM）、e2e（真实 Electron 冒烟，隐藏窗口）。
> 运行入口：`node scripts/verify.mjs` → 输出 `artifacts/acceptance-report.md` + JSON。

| T | 功能点 | 层 | 方法与断言 |
|---|---|---|---|
| T01 | F01 多窗口 | e2e | 主窗加载完成；RPC 打开 settings/search 窗 → WebContents 计数=3；关窗退出码 0 |
| T02 | F02 RPC 总线 | unit+int | 帧编解码正确性；fork 真实 daemon：方法表往返、未知方法返回 error；kill 后 main 侧重启成功 |
| T03 | F03 存储 | unit | sqlite/json 两实现参数化：sessions/messages/settings/memory CRUD、损坏恢复（写坏 magic byte 后打开返回 recovered）、WAL checkpoint 不抛错 |
| T04 | F04 引擎 | int | mock LLM 脚本：①纯文本回复→事件序列 status→token*→done；②带 tool_call（write_file）→ 观察到 tool_call/tool_result/done 且文件落盘 |
| T05 | F05 预热池 | unit | 开启时池维持 1 空闲；activate 消耗并补货；进程被杀 → replenish 事件；关闭时 0 进程 |
| T06 | F06 工具 | unit | 每工具正常/异常/越界路径：read_file 行窗、write_file 建目录、run_command 超时、search 命中行号、skill_read |
| T07 | F07 模式策略 | int | ask 模式诱导 write_file/run_command → ok:false reason:policy；plan 模式读通过、写被确认或拒；craft 全通过 |
| T08 | F08 沙箱 | unit | WorkBuddy 规则等价用例：`~/.ssh/id_rsa` read/write/delete 均 deny；Temp allow；workspace allow；外部路径 write deny；通配边界（`**` 跨段） |
| T09 | F09 确认门控 | int | `run_command "rm -rf x"` → confirm_request → 拒绝 → 工具结果 denied；批准路径执行成功；plan 模式写操作必确认 |
| T10 | F10 凭证 | unit+int | settings 存 key 后 DB 无明文；引擎沙箱读 keystore 路径被 deny |
| T11 | F11 技能 | unit+int | frontmatter 解析（含 disable/缺字段）；skills.list 含样例；引擎 system 含技能清单且 skill_read 可读正文 |
| T12 | F12 市场 | int | zip 导入→list 出现→卸载；重复导入报错；T12c 内置 evidence-check 技能可扫描可读（skill-parity 方法学落库） |
| T13 | F13 记忆 | int | 写 preference → 下次引擎请求 system 含该文本；删除后消失 |
| T14 | F14 终端 | int | create→写 `echo __T14__`→收到含标记 data；kind 记录 pty/pipe |
| T15 | F15 搜索 | int | 预置会话+工作区文件 → query 返回两类命中与定位 |
| T16 | F16 deeplink/托盘 | e2e | 第二实例 `myagent://session/<id>` → 首实例 pendingUrls 消费；托盘已创建 |
| T17 | F17 渲染 | e2e | 注入代码块/公式/XSS 样本 → highlight、katex、无 script 执行 |
| T18 | F18 设置/自检 | unit+e2e | selfcheck 字段非空；设置改主题跨窗同步；导出/清空流程 |
| T19 | F19 mermaid | unit+e2e | T20a 含 mermaid 提取断言；冒烟 `mermaid-render`：flowchart 样本 → svg 出现；XSS 不复活 |
| T20 | F20 文档预览 | unit+e2e | T20a 类型识别表；冒烟 `preview-window`：`files.readBinary` 往返 + `openPreview` 第 4 窗 + base64 解码；真实渲染手工 |
| T21 | F21 更新器 | unit+int+e2e | semver/sha256 失败路径；本地清单源 check→download→verify→ready；冒烟 `updater-status` 字段 |
| T22 | F22 browser-use | unit+int | 动作协议校验与 read/exec 分层；系统 Edge headless 走 fixture 页 navigate→snapshot→click→screenshot；无浏览器 skip=DEGRADED |
| T23 | F23 IM 通道 | unit+int+e2e | 去重环 500/分块/回退；mock Telegram API 全链路（入站→引擎→出站、401、5 连败）；状态机；冒烟 `im-status` |
| T24 | F24 分享目标 | unit+e2e | AppxManifest XML 结构 + ps1 语法解析；冒烟 `--share` 参数 → 会话出现共享文件消息；真实注册手工 |
| T25 | F25 云市场 | unit+int+e2e | 关键词匹配 + http 策略；本地源 search/install/already/refused(hash)；冒烟 `market-status` |
| T26 | F26 同步 | int+e2e | 目录双实例互通；rev 冲突 `.conflict.json` 零丢失；webdav mini 服务同断言；冒烟 `sync-status` |
| T27 | F27 云沙箱 | int+e2e | mock e2b 服务：fs/exec 往返；401 单次重连成功；持续 401 fail-closed；重连 10s 去重；冒烟 `cloud-sandbox-field` |
| T28 | F28 A2A | int+e2e | `message/send` 往返（mock LLM）；agent_delegate 闭环；card 字段；冒烟 `a2a-card` HTTP 200 |
| T38 | F46 web 检索 | unit | bing SERP 解析（title/url/snippet+实体解码）；htmlToText 剥 script/style；注入 fetch 断言 cn.bing.com 请求形态与 HTTP/传输错误即值；本地 http 真取 + max_chars 截断 + 非 http 拒绝 |
| T39 | F47 present_file | unit+int | 交付到戳目录/沙箱拒绝/缺失即值；真实 daemon 下 `tool_result.artifact` 指向 `MYAGENT_DELIVERY_DIR` 隔离交付目录 |
| T40 | F45 步数预算 | int | `engine.maxSteps=2` → done(reason=max-steps) 且工具仍执行；同引擎「继续」续跑至 complete（history 保留） |
| T41 | F48/F49 计划与度量 | int | todo 事件全量替换、tool_call 携带 step/maxSteps、done 携带累计 usageTokens（mock usage 透传） |
| T42 | F50 上下文压缩 | unit+int | 组完整性（tool 不孤儿）/预算/标记；真实 daemon 下 tool-heavy 任务后续请求有界且带 `[context compacted]` |
| T43 | F51 消息落库 | int | 会话轮后 sessions.get 回放 user→tool(带 tool_name/tool_json)→assistant 全序 |
| T44 | F44/F45/F47-F49 渲染反馈面 | e2e | 注入引擎事件断言：write_file 产物卡、todo 计划卡（勾选/划线）、进度行（第N/M步·工具·耗时）、tool_result 原地合并+failed 徽标+detail、done 后进度行隐藏+用量行；F55 修订：仅成功工具结果生成产物卡，present_file 默认开右侧预览，独立窗为显式操作 |
| T47 | F53 内置 Claude 技能市场 | unit+int | T12d 纯 JS 解压（zip-slip 拒绝）；T47a 块标量 frontmatter、目录完整性（tree_sha256 逐技能）、四个文档技能 view-only、篡改 → hash_mismatch；T47b daemon market.list/install + 引擎 market 工具 search→install |
| T48 | F54 侧栏六项 + 技能页 | e2e | ui-nav（六行文案、202px、y=96、会话时间列）；ui-hub（Claude 卡片渲染、仅查看、真实点击首个未装卡片安装 → 已安装 + skills.list 可见，随后卸载复原） |
| T49 | 逐按钮结果审计 | e2e | `scripts/button-audit.mjs` 91 项：主窗/设置窗/搜索窗全部控件按效果断言（daemon 状态、窗口状态、磁盘、LLM 实收内容），见 design/36 |
| T50 | F55 会话产物中心 | unit+int+UI | artifact 持久化/历史恢复/后台隔离/成功后登记；右侧折叠与选择；文件路径原生操作门控；共享安全预览；详见 38-artifact-center.md |
| T51 | F56 开源专家市场 | unit+int+审计 | 固化目录完整性（33 位/七分区含金融/sha256 锁 commit）；read 剥 frontmatter + 溯源；导入为预设（meta.source 溯源、prompt 逐字）+ 重复 dedup；篡改拒绝；experts.builtin 关闭；UI 浏览/搜索/筛选/纯文本预览/导入；详见 39-opensource-expert-market.md |
| T52 | F57 社交内容拉取 | unit | social_fetch：HN 适配与 limit/首页双形态；RSS/Atom 解析（CDATA/实体/alternate 链接）；错误即值（非 200/非 feed/传输失败/未知平台）；条数与字数上限；kind=read；详见 40-social-pull.md |
| T53 | F37 会话独立窗口 | unit+e2e | windows.js 单例（640×800/480×600/frameless/URL 参数）、复用 focus+app:pendingUrls 重定向不增窗、无 id 不重定向、closed 释放槽位、selfAction 只作用于调用窗；e2e conversation-window/main-shell/retarget/self 四步；详见 41-conversation-window.md |
| T10c | 凭证键进 vault | int | llm.apiKey / sandbox.cloud.apiKey 经 settings.set 只进 vault；settings:changed 不回显值；旧明文迁移 |
| T37b | / 技能调用 | unit | `/技能名` 附带 SKILL.md 正文；未知名/文中斜杠/路径不触发 |
| T46 | F52 连接器 | int | mock MCP stdio server：add→connected→tools 经 RPC 列出、重名拒装、toggle 停启；连接器工具进引擎（exec 类）并经 daemon 桥完成 tools/call 往返（结果回喂 LLM） |

**验收门槛**：全部 T 通过；`artifacts/acceptance-report.md` 逐项记录 PASS/DEGRADED（降级需注明原因）
/FAIL。任何 FAIL → 归因二选一：(a) 方案设计问题 → 改实现；(b) WorkBuddy 理解问题 →
回逆向补证据、改设计文档与实现，复跑直至绿。

**手工抽查清单**（自动化难覆盖，验收时人工过一遍）：
1. 关闭主窗到托盘，再次点击恢复。 2. 崩溃模拟：任务管理器杀 renderer，daemon 会话仍在。
3. 真实 LLM 端点一次完整任务对话（配置自备）。 4. ask 模式下让模型"创建文件"，观察拒绝话术。
5. 真实 docx/pdf/xlsx/pptx 各开一次预览窗（F20）。 6. 真实 Telegram bot token 收发一轮（F23）。
7. 管理员运行 register.ps1 后右键分享一个文件（F24）。 8. 自建更新源走一次完整 apply+过渡窗（F21）。
9. 有 e2b 账号时云内跑一次命令（F27）；两机目录同步互通（F26）。
