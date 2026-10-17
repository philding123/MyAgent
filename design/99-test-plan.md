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
| T12 | F12 市场 | int | zip 导入→list 出现→卸载；重复导入报错 |
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

**验收门槛**：全部 T 通过；`artifacts/acceptance-report.md` 逐项记录 PASS/DEGRADED（降级需注明原因）
/FAIL。任何 FAIL → 归因二选一：(a) 方案设计问题 → 改实现；(b) WorkBuddy 理解问题 →
回逆向补证据、改设计文档与实现，复跑直至绿。

**手工抽查清单**（自动化难覆盖，验收时人工过一遍）：
1. 关闭主窗到托盘，再次点击恢复。 2. 崩溃模拟：任务管理器杀 renderer，daemon 会话仍在。
3. 真实 LLM 端点一次完整任务对话（配置自备）。 4. ask 模式下让模型"创建文件"，观察拒绝话术。
5. 真实 docx/pdf/xlsx/pptx 各开一次预览窗（F20）。 6. 真实 Telegram bot token 收发一轮（F23）。
7. 管理员运行 register.ps1 后右键分享一个文件（F24）。 8. 自建更新源走一次完整 apply+过渡窗（F21）。
9. 有 e2b 账号时云内跑一次命令（F27）；两机目录同步互通（F26）。
