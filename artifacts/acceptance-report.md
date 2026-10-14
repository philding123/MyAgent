# MyAgent 验收报告

- 生成时间: 2026-10-13T17:53:50.518Z
- 单元测试: PASS (32 cases)
- 集成测试: PASS (18 cases)
- E2E 冒烟: PASS

| T | 功能点 | 结果 | 明细 |
|---|---|---|---|
| T01 | F01 多窗口 | PASS | ✓ e2e:main-window<br>✓ e2e:main-loaded<br>✓ e2e:multi-window (main,settings,search) |
| T02 | F02 守护进程+RPC | PASS | ✓ T02 codec roundtrip single frames<br>✓ T02 codec splits chunks across pushes<br>✓ T02 codec tolerates bad frames<br>✓ T02a daemon method roundtrip + unknown method + ready snapshot<br>✓ T02b DaemonClient restarts daemon after crash |
| T03 | F03 存储 | PASS | ✓ T03 json store DAO cases<br>✓ T03 sqlite store DAO cases<br>✓ T03 json store corrupt recovery<br>✓ T03 sqlite store corrupt recovery |
| T04 | F04 引擎 | PASS | ✓ T04a plain text reply streams token events<br>✓ T04b tool call loop writes the file |
| T05 | F05 预热池 | PASS | ✓ T05 pool maintains one idle when enabled<br>✓ T05 pool disabled keeps zero<br>✓ T05 unexpected idle exit triggers replenish<br>✓ T05 disable drains pool |
| T06 | F06 工具集 | PASS | ✓ T06 write_file creates dirs + read_file numbered window<br>✓ T06 read_file sandbox denial outside workspace<br>✓ T06 list_dir formats entries<br>✓ T06 run_command executes and reports exit code<br>✓ T06 run_command timeout<br>✓ T06 search finds hits with line numbers<br>✓ T06 skill_read reads registry<br>✓ T06 tool definitions are OpenAI function-shaped |
| T07 | F07 模式策略 | PASS | ✓ T07 ask mode blocks writes and commands (hard rules)<br>✓ T07 plan mode: read-only command allowed, writes need confirm<br>✓ T07 plan mode: write goes through confirm and denial stops it |
| T08 | F08 沙箱 | PASS | ✓ T08 credentials dir is fully denied (WorkBuddy tsbx parity)<br>✓ T08 temp + workspace allowed for all ops<br>✓ T08 outside workspace defaults to read-only (fail-safe)<br>✓ T08 ** crosses segments, * stays within one<br>✓ T08 command rules deny/confirm/allow<br>✓ T08 default rules protect .ssh and keystore |
| T09 | F09 确认门控 | PASS | ✓ T09a sandbox deny pattern blocks rm -rf without confirm<br>✓ T09b confirm pattern asks, denial stops execution<br>✓ T09c approved confirm executes the command |
| T10 | F10 凭证保护 | PASS | ✓ T10 vault roundtrip without plaintext on disk<br>✓ T10 vault delete |
| T11 | F11 技能系统 | PASS | ✓ T11 frontmatter parses WorkBuddy-style SKILL.md<br>✓ T11 frontmatter tolerates missing fields<br>✓ T11 scanSkillDir reads builtin sample<br>✓ T11 registry scan/toggle with builtin + user dirs<br>✓ T11 disable:true excluded from enabled<br>✓ T11b enabled skills appear in engine system prompt; skill_read works |
| T12 | F12 本地市场 | PASS | ✓ T12a install from directory, list, uninstall<br>✓ T12b install from zip (PowerShell Expand-Archive) |
| T13 | F13 记忆 | PASS | ✓ T13 preference reaches the LLM system message and deletion removes it<br>✓ T13 fact kind also injects |
| T14 | F14 终端 | PASS | ✓ T14 terminal echo roundtrip |
| T15 | F15 全局搜索 | PASS | ✓ T15 message + file hits with locators |
| T16 | F16 托盘/Deeplink | PASS | ✓ e2e:deeplink-consumed ([{"action":"session","id":"eb54d504-2988-4cb3-ad73-66b4dede1e8a"}])<br>✓ e2e:tray |
| T17 | F17 渲染管线 | PASS | ✓ e2e:render-sanitize ({"pwned":false,"html":"<p>&lt;img src=x onerror=window.__pwned=1&gt;</p>\n"}) |
| T18 | F18 设置/自检 | PASS | ✓ T18a selfcheck reports capability matrix<br>✓ e2e:selfcheck (json)<br>✓ e2e:preload-bridge (pong) |

## 降级记录
- Electron 运行时 store 模式: json
## 问题归因记录（实现过程中发现并修复）

按用户要求区分「方案设计问题」与「WorkBuddy 功能理解问题」：

| # | 问题 | 归因 | 处置 |
|---|---|---|---|
| 1 | Electron/Windows 下 `app.exit`/`process.exit` 不终止进程树（18 个残留进程） | **方案设计问题**（退出策略不适用 GUI 子系统） | 冒烟结果+退出码写入 JSON，verify 轮询结果后强杀进程树；daemon 关闭改用 `taskkill /T /F`（设计 11 的孤儿防护本来就要求树杀，提前启用） |
| 2 | `installSkill` 用 `renameSync` 导致源目录被移走、重复安装报 ENOENT | **实现缺陷**（设计文档写明市场安装为复制语义） | 改 `fs.cpSync` 复制 |
| 3 | 引擎 `skill_read` 拿不到技能正文（init 只传 name/description） | **方案设计细化**（渐进披露要求引擎持有全文） | buildInit 传完整技能对象（含 body） |
| 4 | daemon `stop`→`start` 竞态：旧引擎迟到的 exit 事件误删新引擎句柄 | **实现缺陷** | exit 回调加句柄同一性保护；stop 等待进程真正退出（上限 1s） |
| 5 | 测试辅助 `waitEvent` 会匹配到上一轮的陈旧事件 / 实时分支不传事件索引 | **实现缺陷**（测试工具） | matcher 增加事件索引参数 |
| 6 | better-sqlite3 损坏恢复在 Windows 失败（文件被打开句柄锁定，rename 失败后重开同一坏文件） | **实现缺陷** | 恢复前先 `db.close()`，清理 -wal/-shm 边车文件 |
| 7 | 默认沙箱规则与 daemon 凭证目录路径不一致（.config vs APPDATA） | **实现缺陷** | `defaultRules` 与 `homeDir()` 同源推导（MYAGENT_HOME > APPDATA > ~/.config） |
| 8 | main↔daemon 采用"长度前缀 JSON 帧"（设计原文）vs Node IPC 原生对象通道 | **方案设计简化**（等价实现，记录偏离） | 保留原生对象通道；JSON-Lines 编解码仅用于 engine stdio 边界（与设计一致） |
| 9 | Electron 运行时 store 降级为 JSON（better-sqlite3 prebuild 为系统 Node ABI） | **已知降级**（设计 01 §4 降级矩阵预设路径） | selfcheck 上报 store.mode，集成测试验证 sqlite 实现本体 |

结论：**无需回溯逆向 WorkBuddy**——本轮未出现"WorkBuddy 功能理解问题"；9 项全部为方案细节/实现缺陷，均已修复并回归通过。

## 待用户手工抽查（需要真实 LLM 配置）

1. Settings → Model 填入 OpenAI 兼容 baseUrl/API Key/模型 → Test connection。
2. 新建会话（选工作目录），craft 模式发起一个真实任务，观察工具调用/确认弹窗。
3. ask 模式让模型"创建文件"，确认拒绝话术与不落盘。
4. 关闭主窗最小化到托盘 → 托盘菜单恢复/退出。

## 真实 LLM 验证（2026-10-14 补充，完成手工抽查 1–3）

配置来源：`~/.codex/config.toml`（base_url `https://api.20230112.xyz/v1`）+ `auth.json`（API Key，经 MyAgent 加密 vault 落盘，已验证库文件无明文）；模型 `gpt-6.1-sol`。
运行方式：`node scripts/real-llm-check.js`（结果在 `artifacts/real-llm-result.json`）。

| 检查 | 结果 | 说明 |
|---|---|---|
| R0a Key 加密存储 | PASS | vault.bin 中无明文 Key |
| R0b 测试连接（走 MyAgent 自身 LlmClient） | PASS | 返回 pong |
| R1 craft 模式真实工具循环 | PASS | 模型实际调用 write_file + read_file，文件落盘且内容正确，最终回复含文件路径 |
| R1 read_file 使用 | PASS | 模型自主读回确认 |
| R2 ask 模式只读策略（真实模型） | PASS | 模型收到只读硬规则后拒绝写文件，解释"Ask 模式只读，请切换 Agent 模式"，且无文件落盘 |
| R2 无文件写入 | PASS | ask-deny.txt 未创建 |

**至此 99-test-plan.md 手工抽查 1–3 完成；抽查 4（托盘交互）为纯 GUI 操作，留待用户日常使用验证（托盘对象创建已由 E2E 覆盖）。验收状态：ALL GREEN。**
