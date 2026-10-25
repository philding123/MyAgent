# AGENTS.md — app/daemon 详细契约

## 1. 职责与定位

常驻业务进程。Electron main 通过 `child_process.fork` 拉起（`require.main === module` 分支走进程协议：`{kind:'request'}` → `{kind:'response'}`，`{kind:'event'}` 推送）。**必须无 Electron 依赖**，保证能在纯 Node 下被集成测试 fork。

上游：main 进程（DaemonClient）。下游：engine 子进程（engine-host fork）、PTY 子进程（terminal）。对 renderer 暴露的能力 = `index.js#methods` 方法表。

## 2. 结构与组件

| 文件 | 职责 | 关键点 |
|---|---|---|
| `index.js` | `createDaemon({send})` + methods 方法表 + snapshot + shutdown | 新业务能力唯一入口；`homeDir()`：MYAGENT_HOME > APPDATA/myagent > ~/.config/myagent |
| `store.js` | `openStore()` → SqliteStore / JsonStore（同 DAO） | WAL + 启动 checkpoint；损坏恢复（close→清 -wal/-shm→改名 .corrupt-ts→重建，置 recovered） |
| `sandbox.js` | `Sandbox` 规则引擎 + `defaultRules()` | 规则格式同 WorkBuddy tsbx_rules.json；`checkFile(path, op)`、`checkCommand(cmd)` → allow/deny/confirm |
| `skills.js` | SkillRegistry（多目录扫描/启停/读取）+ install/uninstall | frontmatter 解析支持块列表、YAML 块标量（`>`/`|`/`|-`）与引号串；install=**复制**（市场语义，源目录不动） |
| `engine-host.js` | EngineHandle/EngineHost/PrewarmPoolProbe | 每会话一引擎；pool 激活补货；stop() 等待 exit（≤1s）；exit 回调带句柄同一性保护 |
| `terminal.js` | TerminalHost | 优先 @lydell/node-pty（kind='pty'），降级 child_process（kind='pipe'）；win32 shell 取 ComSpec |
| `market.js` | Market：内置目录（F53，`builtin:` 源复制安装 + tree_sha256 复核）+ 远端源（F25，zip + sha256） | 返回 installed/already_installed/refused；`installable:false` 直接 refused 带原因；不升级已装 |
| `expert-catalog.js` | F56 开源专家目录（market/agency-experts）：experts.list/read/import（design/39） | persona sha256 校验后逐字读取；导入=presets.create 带 meta.source 溯源；`experts.builtin=false` 关闭；专家≠技能≠A2A |
| `unzip.js` | 纯 JS zip 解压（stored/deflate） | zip-slip/符号链接/加密条目整体拒绝，先校验后落盘；各平台一致 |
| `search.js` | globalSearch(store, q, workspace) | 会话库 LIKE + 工作区行级扫描（忽略 node_modules/.git 等，上限 50 条） |
| `crypto.js` | CredentialVault | safeStorage 优先，降级 AES-256-GCM + 0600 keyfile；条目前缀 ss:/aes: |
| `jsonl.js` | JsonlCodec | 引擎 stdio 边界专用；坏帧转 `{type:'error'}` |

## 3. 铁律与不变式

- **方法表即边界**：renderer 能做什么完全由 methods 决定；加方法 = 同时考虑是否需要进 `snapshot()`。
- **DAO 双实现一致性**：任何 SQL/JSON 行为差异都是缺陷；T03 参数化测试是回归底线。
- **沙箱默认 fail-safe**：`defaultRules` 由 `homeDir()` 同源推导 keystore 拒绝路径（勿写死 .config）。
- **引擎生命周期**：先 `stop()`（等 exit）再 `start()`；exit 事件只能删除 map 中指向同一 handle 的条目。
- **技能安装是复制**：重名报错 `already installed`（T12 断言）。

## 4. 开发与测试

- 集成测试入口：`tests/helpers.js#forkDaemon(tempHome)`（协议级 fork 客户端，支持 request/waitEvent）。
- 相关测试：T02（协议/重连）、T03（存储）、T08（沙箱）、T10（vault）、T11/T12（技能）、T13（记忆）、T14（终端）、T15（搜索）、T18（selfcheck）。
- 跑法：`npm run test:int`；单文件 `node --test tests/integration/T14-terminal.test.js`。
