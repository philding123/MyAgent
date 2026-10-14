# ADR 2026-10-14 · Electron 冒烟退出码策略

- 状态：Accepted（2026-10-14）
- 关联：app/main/index.js#runSmoke、scripts/verify.mjs §e2e

## 背景

Windows 上 Electron（GUI 子系统）在 `app.exit`/`process.exit` 后进程树可能不终止（曾残留 18 个进程）；spawnSync 对其也拿不到退出码（status=null）。详见 issue [electron-process-tree-exit](../issues/2026-10-14-electron-process-tree-exit.md)。

## 决策

1. 冒烟结果与 `exitCode` 写入 `MYAGENT_SMOKE_OUT` 指向的 JSON——**退出码唯一权威是 JSON，不是进程退出码**。
2. verify.mjs 轮询结果 JSON（120s 上限）判定 e2e 结果，随后按路径过滤强杀残留 electron 进程。
3. 冒烟模式：窗口 `show:false`（MYAGENT_SMOKE=1）、close 直通、daemon shutdown 用 taskkill 树杀。
4. 正常 GUI 模式不受影响：主窗关闭进托盘，真退出走托盘 Quit。

## 后果

- 手动跑冒烟时进程可能残留属预期，验收脚本会收割。
- 若未来 Electron 修复该行为可简化，但 JSON 协议保留（更稳健）。
