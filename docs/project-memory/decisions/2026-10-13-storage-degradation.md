# ADR 2026-10-13 · 存储双实现与降级矩阵

- 状态：Accepted（2026-10-13）

## Decision

1. `openStore()` 能力探测：better-sqlite3 可加载 → SqliteStore，否则 → JsonStore（原子写 tmp+rename）。
2. **两实现必须保持同一 DAO 接口**（sessions/messages/settings/memory/logs + health/checkpoint），T03 参数化测试同时覆盖并断言损坏恢复行为。
3. 库损坏恢复协议：close 句柄 → 清 -wal/-shm 边车 → 改名 `.corrupt-<ts>` 备份 → 重建，置 `recovered:true` 供 UI 提示。
4. selfcheck 上报 `store.mode`，验收报告记录降级事实。

## Context

对标 WorkBuddy 使用 better-sqlite3（WAL + checkpoint worker）。但 npm 安装的 better-sqlite3 prebuild 是系统 Node ABI，在 Electron 运行时内无法 require（ABI 不匹配）；electron-rebuild 引入原生构建链，Phase-1 不值得。

## Options Considered

- 强制 electron-rebuild（否决：Phase-1 引入原生构建链维护成本，Windows CI 复杂化）。
- 只用 JSON 存储（否决：偏离 WorkBuddy 的 SQLite 语义，大数据量性能差）。
- 双实现能力探测 + 降级（选定）。

## Rationale

DAO 接口统一后，上层（daemon 方法表/引擎宿主）对后端无感知；能力探测使同一份代码在系统 Node（集成测试，sqlite）与 Electron 运行时（json）下都可用。

## Consequences

- 任何存储层改动必须 sqlite/json 双实现同步 + 跑 T03。
- Electron 端当前实际运行 JSON store（已知降级，记录于验收报告）。
- Phase-2 候选：引入 electron-rebuild 让 Electron 端用真 SQLite。

## Verification

- T03 参数化用例：sqlite/json 双实现跑同一组 DAO 用例（CRUD/搜索/损坏恢复/备份文件存在断言）。
- `app.selfcheck` 上报 `store.mode`（E2E 冒烟断言 store.ok）。
