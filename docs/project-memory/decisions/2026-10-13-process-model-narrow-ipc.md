# ADR 2026-10-13 · 三层进程模型与窄 IPC

- 状态：Accepted（2026-10-13）
- 关联：design/01-architecture.md、design/11-daemon-rpc.md

## 背景

逆向观察（WorkBuddy）：主进程 152 模块仅暴露 28 个窄 IPC 通道，业务走 `wb:invoke` 总线到常驻 daemon；agent 引擎是独立 headless CLI（cli-prewarm-pool 预热）。

## 决策

1. 三层：Electron main（OS 集成）→ 常驻 daemon（业务方法表，纯 Node 可测试）→ 每会话一个 engine 子进程（JSON-Lines stdio）。
2. **窄 IPC 铁律**：主进程仅 `rpc` 与 `rpc.window` 两个 handle；新业务能力一律进 daemon `methods{}` 表。
3. RPC 契约：`{id, method, params}` → `{id, ok, result | error}`；事件 topic `engine:{sessionId}` / `terminal:{id}:data` 等。
4. daemon 崩溃由 main 指数退避重启（≤5 次）；daemon 子进程树经 `taskkill /T /F` 清理。
5. 模式策略（ask/plan/craft）在引擎侧代码强制（policy.js），提示词只是第一层。

## 后果

- UI 崩溃重开不丢任务（daemon/engine 独立生命周期）。
- daemon 保持零 Electron 依赖，集成测试可直接 fork；新增能力禁止开新 IPC 通道。
