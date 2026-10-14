# Issue 2026-10-14 · Windows 下 SQLite 损坏恢复被文件锁卡死

- 状态：Resolved（2026-10-14）
- 关联：T03（json/sqlite 损坏恢复用例）

## Symptoms

构造损坏库文件（非 SQLite magic bytes）后打开，`SqliteStore` 抛 `SQLITE_NOTADB` 未被恢复逻辑接住，测试失败。设计预期是损坏库被改名备份后重建空库。

## Impact

损坏恢复兜底失效 → 库损坏后 daemon 无法启动；T03 回归失败。

## Root Cause

1. better-sqlite3 的 `new Database()` 打开是惰性的，损坏在首次 `pragma('journal_mode = WAL')` 才抛错；
2. 恢复分支里 `fs.renameSync` 前未关闭已打开的坏句柄——Windows 下打开中的文件被锁定，rename 静默失败（被 `catch(_){}` 吞掉）；
3. 随后重开同一坏文件，`exec(SCHEMA)` 在 try 块之外抛出。

## Resolution

恢复分支顺序改为：`db.close()` 关句柄 → 依次清理 `-wal`/`-shm` 边车文件 → 逐个改名 `.corrupt-<ts>`（rename 失败则 unlink 兜底）→ 重新打开 + WAL + SCHEMA，置 `recovered:true`。

## Validation

T03 sqlite 损坏恢复用例：recovered 标记为 true、`.corrupt-` 备份文件存在、重建后 DAO 可用；`npm run verify` 全绿。

## Prevention

损坏恢复协议已固化在 `SqliteStore` 构造器与 ADR storage-degradation；T03 参数化用例作为常规回归。附注：同轮相邻测试基建缺陷（EngineHost stop→start 竞态、waitEvent 陈旧事件索引）一并修复，归因表见 `artifacts/acceptance-report.md` 附录。
