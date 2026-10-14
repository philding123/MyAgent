# Issue 2026-10-14 · Windows 下 SQLite 损坏恢复被文件锁卡死

- 状态：Resolved（2026-10-14）
- 影响面：app/daemon/store.js SqliteStore 损坏恢复路径
- 关联：T03（json/sqlite 损坏恢复用例）

## 症状

构造损坏库文件（非 SQLite magic bytes）后打开，`SqliteStore` 抛 `SQLITE_NOTADB` 未被恢复逻辑接住，测试失败。设计预期是损坏库被改名备份后重建空库。

## 根因

1. better-sqlite3 的 `new Database()` 打开是惰性的，损坏在首次 `pragma('journal_mode = WAL')` 才抛错；
2. 恢复分支里 `fs.renameSync` 前未关闭已打开的坏句柄——Windows 下打开中的文件被锁定，rename 静默失败（被 `catch(_){}` 吞掉）；
3. 随后重开同一坏文件，`exec(SCHEMA)` 在 try 块之外抛出。

## 解决

恢复分支顺序改为：`db.close()` 关句柄 → 依次清理 `-wal`/`-shm` 边车文件 → 逐个改名 `.corrupt-<ts>`（rename 失败则 unlink 兜底）→ 重新打开 + WAL + SCHEMA，置 `recovered:true`。

## 防回归

T03 参数化用例覆盖 sqlite/json 双实现的损坏恢复（断言 recovered 标记 + .corrupt 备份文件存在），属于 `npm run verify` 常规回归。

## 附注

同轮还发现两个相邻测试基建缺陷（非本 issue 范围）：EngineHost stop→start 竞态（迟到的 exit 事件误删新句柄）与测试 waitEvent 不传事件索引导致匹配陈旧事件——均已修复，归因表见 `artifacts/acceptance-report.md` 附录。
