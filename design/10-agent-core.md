# 10 · Agent 核心：引擎 / 工具 / 预热池 / 交互模式（F04 F05 F06 F07）

## F04 Agent 执行引擎（headless 子进程 + JSON 流）

**WorkBuddy 观察**（证据）：
- 引擎独立打包为 CLI：`app.asar.unpacked/cli/bin/codebuddy`、`cli/dist/codebuddy-headless.js`（11.4MB）
  与 `codebuddy-lite-wb.mjs`（8.2MB），package name `@genie/agent-cli`，bin 别名 `cbc`。
- 桌面端 `main/cli-process-env.js` 注入专用环境；CLI 依赖含
  `@modelcontextprotocol/sdk`、`@a2a-js/sdk`、`@agentclientprotocol/sdk`、`@openai/agents`、
  `vscode-languageserver-protocol`、`e2b` —— 即多模型 + MCP + A2A/ACP 能力全在引擎侧。
- 主进程只做进程编排（`bootstrap-daemon-in-main-process.js` 5.4KB 很小，说明引擎自成一体）。

**复现设计**：
- `engine/` 独立目录，纯 Node 运行（无 Electron 依赖），`spawn( process.execPath 为 daemon 的 node )`
  —— 实现为 `fork('engine/index.js')` 从 daemon 拉起，stdio 走 JSON-Lines：
  - stdin 控制消息：`{type:'user', text, mode}`、`{type:'confirm', id, approved}`、`{type:'abort'}`
  - stdout 事件流：`{type:'status', stage}`、`{type:'token', text}`、
    `{type:'tool_call', id, name, args}`、`{type:'tool_result', id, ok, summary}`、
    `{type:'confirm_request', id, command, reason}`、`{type:'done', usage}`、`{type:'error', message}`
- LLM 接入：OpenAI 兼容 `POST {baseUrl}/chat/completions`，`tools` 传函数定义，
  多轮工具循环直到无 tool_calls；`stream:false`（个人用简化，流式在 UI 侧按事件粒度呈现，
  assistant 完整段落后逐块发出 token 事件模拟流式以对齐 UI 行为）。
- 会话↔引擎 1:1（sessionId 传递给引擎，工具 cwd 来自 session.cwd）。

**验证**：集成测试起本地 mock LLM（脚本化返回 tool_calls 序列），断言事件序列与工具副作用
（文件被写、命令被执行）；见 99-test-plan.md T04。

## F05 进程预热池

**WorkBuddy 观察**：`main/cli-prewarm-pool.js`（19KB，反混淆）：
预启动多个 headless 进程待命（"prewarm entry"），激活时绑定 sessionId
（"activated prewarm entry exited unexpectedly (id, pid, sessionId)"），
意外退出自动补货（`scheduleReplenish('unexpected_exit')`），并采样 CPU（`process-cpu-sampler.js`）。

**复现设计**：daemon 内 `PrewarmPool`：维持 N=1 个空闲引擎进程（默认关，设置可开）；
`engine.start` 优先取空闲进程并回放 system 上下文（模式+技能+记忆）后激活；
激活失败/进程早退 → 重新孵化并标记 `degraded:true` 事件。CPU 采样不做（个人用无此需求，偏离记录）。

**验证**：单元测试模拟池行为（取用→补货→早退补货）；E2E 冒烟检查池开关为 off 时无残留进程。

## F06 内置工具集

**WorkBuddy 观察**：CLI vendor 带 ripgrep（`cli/vendor/ripgrep/x64-win32/rg.exe`）、
node-pty；`interactionmode/ask/fragments/tool-use.md` 定义工具使用纪律；
ask 模式硬规则明确"read-only tools to inspect files"——说明工具带读写类别标记。

**复现设计**（engine/tools/）：
| 工具 | 行为 | 类别 |
|---|---|---|
| `read_file{path,offset?,limit?}` | 文本读取，默认上限 2000 行 | read |
| `list_dir{path}` | 名称/类型/大小 | read |
| `write_file{path,content,create_dirs?}` | 写文件；路径必须过沙箱 | write |
| `run_command{command,cwd?,timeout_ms?}` | 经沙箱评估；deny 即拒；need_confirm 触发确认流 | exec |
| `search{query,path?,glob?}` | 会话库 + 工作区文件（忽略 node_modules/.git，纯 JS 实现，不依赖 rg） | read |
| `skill_read{name}` | 读取已启用技能的 SKILL.md 正文（技能按需注入的入口） | read |

所有工具结果返回 `{ok, summary(截断), data?}`；错误不抛异常，作为工具结果回给模型。

**验证**：单元测试覆盖每个工具正常/异常/沙箱拒绝路径；T06。

## F07 交互模式与工具策略（ask / plan / craft）

**WorkBuddy 观察**：`interactionmode/ask/fragments/current-mode.md` 原文（提取）：
> You are currently running in Ask mode (Talk only, hands off).
> Hard rules: Only answer questions, read files... You must NOT modify files or run shell commands...

模式经 `prompt.tpl`（nunjucks，变量 `workMode/modelId/modelName/productName/productFeatures.*`）
include 进系统提示；五个模式 ask/plan/expert/quick/craft，对应插件
`interactionmode-{ask,plan,expert,quick,craft}`。

**复现设计**：三个模式（对齐其核心三态）：
- `ask`：系统提示注入等价硬规则；**引擎侧强制**：write/exec 工具调用直接返回策略拒绝
  （不依赖模型自觉——这是比 WorkBuddy 提示更强的实现，属于"复现+加固"，记录为有意偏离）。
- `plan`：允许 read + run_command(只读类命令白名单：`ls/dir/type/cat/git status` 等前缀匹配)；
  写操作需确认。
- `craft`：全部工具，写与 exec 按沙箱/确认规则走。
模式作为引擎 system 消息的一部分 + 引擎侧策略层双保险。

**验证**：集成测试分别在 ask/plan 模式诱导写文件/危险命令，断言被策略层拒绝且产生
`tool_result{ok:false, reason:'policy'}`；T07。
