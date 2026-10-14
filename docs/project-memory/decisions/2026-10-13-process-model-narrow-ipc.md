# ADR 2026-10-13 · 三层进程模型与窄 IPC

- 状态：Accepted（2026-10-13）

## Decision

1. 三层：Electron main（OS 集成）→ 常驻 daemon（业务方法表，纯 Node 可测试）→ 每会话一个 engine 子进程（JSON-Lines stdio）。
2. **窄 IPC 铁律**：主进程仅 `rpc` 与 `rpc.window` 两个 handle；新业务能力一律进 daemon `methods{}` 表。
3. RPC 契约：`{id, method, params}` → `{id, ok, result | error}`；事件 topic `engine:{sessionId}` / `terminal:{id}:data` 等。
4. daemon 崩溃由 main 指数退避重启（≤5 次）；daemon 子进程树经 `taskkill /T /F` 清理。
5. 模式策略（ask/plan/craft）在引擎侧代码强制（policy.js），提示词只是第一层。

## Context

逆向观察（WorkBuddy 证据）：主进程 152 模块仅暴露 28 个窄 IPC 通道，业务走 `wb:invoke` 总线到常驻 daemon；agent 引擎是独立 headless CLI（`cli-prewarm-pool` 预热）。需要决定自研版本的进程拓扑与 IPC 边界。

## Options Considered

- 业务全在主进程（否决：UI 崩溃丢任务、主进程臃肿）。
- 每会话进程内嵌引擎（否决：无法预热、测试不可脱离 Electron）。
- main 窄通道 + daemon 承载业务 + 独立引擎子进程（选定，对齐 WorkBuddy）。

## Rationale

daemon/engine 独立于 renderer 生命周期 → UI 崩溃重开不丢任务；daemon 零 Electron 依赖使集成测试可直接 fork；窄 IPC 让业务边界 = daemon 方法表，可审计。

## Consequences

- 新增业务能力的唯一路径是 daemon 方法表，禁止开新 IPC 通道。
- daemon/engine 必须保持纯 Node 可运行；进程树清理需 taskkill /T /F（Windows）。

## Verification

- T02 集成测试：协议往返、未知方法 `no_method`、daemon kill 后 DaemonClient 自动重启。
- E2E 冒烟：preload-bridge/daemon-ready 步骤；grep 主进程 `ipcMain.handle` 仅 2 个通道。
