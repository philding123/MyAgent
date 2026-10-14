# CLAUDE.md — app/engine

@AGENTS.md

headless agent 引擎（WorkBuddy codebuddy-headless 的对应物）：纯 Node 子进程，stdio JSON-Lines 协议，OpenAI 兼容 LLM 工具循环。

## 常用命令

```bash
node --test tests/integration/T04-engine.test.js   # 引擎全链路（经 daemon）
node --test tests/unit/T06-tools.test.js           # 工具单测（直接 require tools/index.js）
node --test tests/integration/T07-policy.test.js   # 模式策略
```

手动驱动引擎（调试协议）：

```bash
node app/engine/index.js   # 然后向 stdin 粘贴 init/user JSON-Lines
```

## 🚫 绝对禁止

- 不得删除 `policy.js` 的代码层强制（ask/plan 的 write/exec 限制）——提示词只是第一层。
- 不得让工具抛异常穿透到循环外：工具错误必须作为 `{ok:false}` 结果回给模型（tools/index.js 约定）。
- 不得在工具实现里绕过 sandbox（所有路径类操作必须 `checkFile`）。
- 不得增加 Electron 依赖（引擎必须纯 Node）。

## ⚠ 强约束

- 每轮工具循环上限 16 步（`runTurn` for 循环），防失控。
- confirm 请求 120s 超时默认拒绝；批准不持久化。
- 事件顺序契约：`status → (token|tool_call|tool_result)* → done`；done.reason ∈ complete|aborted|max-steps|error。
- 历史消息按 OpenAI 消息数组格式维护（assistant.tool_calls / role:tool 配对），改格式需同步 `llm.js`。

## 子文件路由

| 文件 | 职责 |
|---|---|
| `index.js` | 协议循环 + gateTool（策略/沙箱/确认三级门控） |
| `policy.js` | 模式规则 + system 提示片段（ask/plan/craft） |
| `llm.js` | OpenAI 兼容客户端 + ping |
| `tools/index.js` | 6 个内置工具 + OpenAI function 定义 |
