# GEMINI.md — app/daemon 架构定位

## 定位

MyAgent 的"操作系统层"：业务能力全部沉淀为 daemon 方法表，renderer/引擎/存储在其上调度的常驻进程。对应 WorkBuddy 的 `daemon-app-server` + `wb:invoke` 总线设计。

## 运行与调试

- 被 fork 运行：`child_process.fork('app/daemon/index.js')`，消息协议见 AGENTS.md §1。
- 独立调试：设 `MYAGENT_HOME=<临时目录>` 后 `node app/daemon/index.js`（等待 stdin 协议消息）。
- 测试：`npm run test:int`（forkDaemon 助手在 `tests/helpers.js`）。

## 红线

1. 保持纯 Node 可运行——禁止 require('electron')。
2. 沙箱/凭证/存储三处不变式（见 AGENTS.md §3）不可放宽。
3. 方法表新增方法须同步评估 snapshot 与 selfcheck 是否需要暴露。
4. 引擎/终端子进程必须经 shutdown() 树式清理，防止孤儿进程。

## 模块索引

[index.js](index.js)（方法表）· [store.js](store.js)（DAO）· [sandbox.js](sandbox.js)（规则引擎）· [skills.js](skills.js)（技能）· [engine-host.js](engine-host.js)（引擎池）· [terminal.js](terminal.js)（PTY）· [search.js](search.js) · [crypto.js](crypto.js) · [jsonl.js](jsonl.js)
