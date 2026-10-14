# Issue 2026-10-14 · Electron/Windows 进程树不随 process.exit 终止

- 状态：Resolved（2026-10-14）
- 影响面：E2E 冒烟、应用退出路径
- 关联 ADR：[smoke-exit-code-strategy](../decisions/2026-10-14-smoke-exit-code-strategy.md)

## 症状

E2E 冒烟跑完所有断言并写出结果 JSON 后，electron.exe 进程树（main+gpu+utility+renderer+daemon fork）持续存活（一次曾累积 18 个残留进程）；`app.exit(0)`、`process.exit(0)` 均无效，且 `spawnSync` 对该进程拿不到退出码（status=null）。

## 排查

逐步埋点定位：finishSmoke 确认执行到最后的 `process.exit` 日志行，进程仍存活 → 结论是 Electron/Windows GUI 子系统在无可见窗口上下文下的退出行为问题，而非我们的代码死锁。

## 解决

1. 退出码权威改为冒烟结果 JSON 的 `exitCode` 字段。
2. verify.mjs 轮询结果 JSON 后按路径过滤 `Stop-Process` 收割残留进程。
3. DaemonClient.shutdown 改 `taskkill /PID <pid> /T /F` 树杀（ADR 2026-10-13 的孤儿防护提前启用）。

## 防回归

- verify.mjs e2e 步骤即回归（每轮验收都会走到该路径）。
- 手动跑冒烟出现残留进程属预期，由验收脚本收割。
