# Issue 2026-10-14 · Electron/Windows 进程树不随 process.exit 终止

- 状态：Resolved（2026-10-14）
- 关联 ADR：[smoke-exit-code-strategy](../decisions/2026-10-14-smoke-exit-code-strategy.md)

## Symptoms

E2E 冒烟跑完所有断言并写出结果 JSON 后，electron.exe 进程树（main+gpu+utility+renderer+daemon fork）持续存活（一次曾累积 18 个残留进程）；`app.exit(0)`、`process.exit(0)` 均无效，且 `spawnSync` 对该进程拿不到退出码（status=null）。

## Impact

- verify.mjs 无法以退出码判定 e2e 结果；残留进程累积占用资源，且单实例锁会被占死导致后续冒烟秒退。

## Root Cause

Electron 在 Windows 上的 GUI 子系统退出语义：主进程退出不保证 Chromium 子进程树与 fork 出的 Node 子进程（ELECTRON_RUN_AS_NODE）终止；逐步埋点确认 finishSmoke 执行到了最后一行 process.exit，排除业务死锁。

## Resolution

1. 冒烟结果与 exitCode 写入 `MYAGENT_SMOKE_OUT` JSON——退出码唯一权威。
2. verify.mjs 轮询结果 JSON 后按路径过滤 `Stop-Process` 收割残留进程。
3. DaemonClient.shutdown 改 `taskkill /PID <pid> /T /F` 树杀。

## Validation

`npm run verify` e2e-smoke 全绿（步骤全 ok、JSON exitCode=0）；收割后 tasklist 复查 electron 进程数为 0。

## Prevention

- 退出码权威策略固化为 ADR smoke-exit-code-strategy；新增任何 Electron 冒烟/脚本化启动一律走结果 JSON 协议，禁止依赖进程退出码。
