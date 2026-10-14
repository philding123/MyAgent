# CLAUDE.md — app/daemon

@AGENTS.md

常驻业务进程（WorkBuddy daemon-app-server 的对应物）。所有业务能力的方法表唯一注册处在 `index.js`。

## 常用命令

```bash
node --test tests/integration/T02-daemon.test.js   # 协议级测试（fork 本目录真实进程）
npm run test:int                                    # 全部集成测试
node -e "require('./index.js')"                     # 语法/依赖自检（不会启动循环）
```

调试单模块：`sandbox.js`/`skills.js`/`store.js`/`search.js` 均为纯 Node 模块，可直接 require 做实验；`MYAGENT_HOME` 环境变量覆盖数据目录（测试必设，避免污染真实 `%APPDATA%/myagent`）。

## 🚫 绝对禁止

- 不得在 `methods` 之外新建业务入口（main 进程不得绕过方法表直连内部模块）。
- 不得让 `store.js` 两个实现（Sqlite/Json）出现接口差异——改 DAO 必须两处同步 + 跑 T03。
- 不得移除 `engine-host.js` 的 stop→exit 等待与句柄同一性保护（stop/start 竞态曾导致引擎丢失）。
- 不得把凭证或明文 Key 写进 settings 表（Key 走 `crypto.js` vault）。
- 不得在沙箱规则默认值中放行凭证目录。

## ⚠ 强约束

- `index.js` 以 `require.main === module` 区分「被 fork 运行」与「被测试 require」；新增模块保持无 Electron 依赖（daemon 必须能跑在纯 Node 下）。
- 事件 topic 命名空间：`engine:{sessionId}`、`terminal:{id}:data|exit`、`pool`、`daemon:ready`。
- 退出路径必须走 `shutdown()`：停引擎池 → 停终端 → checkpoint → 关库。

## 子文件路由

| 文件 | 职责 | 详图 |
|---|---|---|
| `index.js` | 方法表 + 生命周期 | [AGENTS.md](AGENTS.md) |
| `store.js` | sqlite/json 双实现 DAO | [AGENTS.md](AGENTS.md) |
| `sandbox.js` | 文件/命令规则引擎 | [AGENTS.md](AGENTS.md) |
| `skills.js` | SKILL.md 解析/扫描/装卸 | [AGENTS.md](AGENTS.md) |
| `engine-host.js` | 引擎进程管理 + 预热池 | [AGENTS.md](AGENTS.md) |
| `terminal.js` | node-pty/管道终端 | [AGENTS.md](AGENTS.md) |
| `search.js` / `crypto.js` / `jsonl.js` | 全局搜索 / 凭证 vault / JSON-Lines 编解码 | [AGENTS.md](AGENTS.md) |
