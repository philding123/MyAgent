# GEMINI.md — app/engine 架构定位

对应 WorkBuddy `@genie/agent-cli` headless 模式的自有实现：把「LLM ↔ 工具」循环隔离在独立进程，使 UI 崩溃/重开不影响任务执行，且引擎可被 CLI/测试直接驱动。

## 运行

- 常规：由 daemon EngineHost fork（stdio JSON-Lines）。
- 手动调试：`node app/engine/index.js`，stdin 依次发 `{type:"init",...}`、`{type:"user",text}`，观察 stdout 事件。

## 红线

1. 模式策略必须代码强制（policy.js），提示词仅为第一道防线。
2. 工具一律过 sandbox；错误返回值不抛异常。
3. 单轮 ≤16 步；confirm 120s 超时默认拒绝。
4. 保持纯 Node、零 Electron 依赖。

## 模块索引

[index.js](index.js)（协议+门控）· [policy.js](policy.js)（模式规则）· [llm.js](llm.js)（LLM 客户端）· [tools/index.js](tools/index.js)（内置工具）
