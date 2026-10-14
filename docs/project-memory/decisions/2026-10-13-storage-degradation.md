# ADR 2026-10-13 · 存储双实现与降级矩阵

- 状态：Accepted（2026-10-13）
- 关联：design/01-architecture.md §4、design/14-data.md、app/daemon/store.js

## 背景

对标 WorkBuddy 使用 better-sqlite3（WAL + checkpoint worker）。但 npm 安装的 better-sqlite3 prebuild 是系统 Node ABI，在 Electron 运行时内无法 require（ABI 不匹配）；electron-rebuild 引入原生构建链，Phase-1 不值得。

## 决策

1. `openStore()` 能力探测：better-sqlite3 可加载 → SqliteStore，否则 → JsonStore（原子写 tmp+rename）。
2. **两实现必须保持同一 DAO 接口**（sessions/messages/settings/memory/logs + health/checkpoint），T03 参数化测试同时覆盖并断言损坏恢复行为。
3. 库损坏恢复协议：close 句柄 → 清 -wal/-shm 边车 → 改名 `.corrupt-<ts>` 备份 → 重建，置 `recovered:true` 供 UI 提示。
4. selfcheck 上报 `store.mode`，验收报告记录降级事实。

## 后果

- 任何存储层改动必须 sqlite/json 双实现同步 + 跑 T03。
- Electron 端当前实际运行 JSON store（已知降级，记录于验收报告）；集成测试验证的是 sqlite 本体。
- Phase-2 候选：引入 electron-rebuild 让 Electron 端用真 SQLite。
