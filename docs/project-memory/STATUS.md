# Project Memory Status

## Snapshot

- Latest daily note: [2026-10-14](./daily/2026-10-14.md)
- Latest decision: [ADR 2026-10-14 · 原生逆向分析引擎选型：WSL2 Ubuntu-24.04 + Ghidra 12.1.4（经 REA）](./decisions/2026-10-14-wsl-ghidra-native-analysis-engine.md)
- Latest issue: [Issue 2026-10-14 · Windows 下 SQLite 损坏恢复被文件锁卡死](./issues/2026-10-14-sqlite-corrupt-recovery-locked-files.md)
- Current todo list: [Project Memory TODO](./todo.md)

## Current Focus

## Now

- 手工抽查第 4 项：托盘点击交互（显示/恢复/退出）——留待日常使用验证，无代码工作。
- Phase-2 立项评估：从 design/90-deferred.md 候选中选定首批（mermaid 渲染 / Office 文档预览 / 自动更新器）并补充设计文档。

## Recent Activity

### Decisions

- [ADR 2026-10-14 · 原生逆向分析引擎选型：WSL2 Ubuntu-24.04 + Ghidra 12.1.4（经 REA）](./decisions/2026-10-14-wsl-ghidra-native-analysis-engine.md)
- [ADR 2026-10-14 · Electron 冒烟退出码策略](./decisions/2026-10-14-smoke-exit-code-strategy.md)
- [ADR 2026-10-13 · 存储双实现与降级矩阵](./decisions/2026-10-13-storage-degradation.md)

### Issues

- [Issue 2026-10-14 · Windows 下 SQLite 损坏恢复被文件锁卡死](./issues/2026-10-14-sqlite-corrupt-recovery-locked-files.md)
- [Issue 2026-10-14 · Electron/Windows 进程树不随 process.exit 终止](./issues/2026-10-14-electron-process-tree-exit.md)

### Daily Notes

- [2026-10-14](./daily/2026-10-14.md)

## Commands

- `./scripts/project-memory.sh daily`
- `./scripts/project-memory.sh decision <slug>`
- `./scripts/project-memory.sh issue <slug>`
- `./scripts/project-memory.sh note <target> <text>`
- `./scripts/project-memory.sh todo-add <section> <text>`
- `./scripts/project-memory.sh refresh`
- `./scripts/project-memory.sh status`
- `./scripts/validate-project-memory.sh`
