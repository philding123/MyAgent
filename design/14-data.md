# 14 · 数据与可靠性：存储 / 自检 / 日志（F03 F18）

## F03 会话持久化

**WorkBuddy 观察**：
- 依赖 better-sqlite3 ^12.8.0；主进程 `app-server-database.js`/`database2.js`（业务 DAO）、
  `wal-checkpoint-worker.js`（独立 worker 做 WAL checkpoint）、`database-recovery-modal`
  （库损坏恢复 UI）、`storage-quota-exceeded-dialog`。
- 会话快照 `conversations:snapshot` 一次性下发；`stale-conversation-status-writeback`
  （状态回写防陈旧）、`localstorage-migration.js`（从 localStorage 迁移历史数据）。

**复现设计**（daemon/store.js）：
- `Store` 接口：`sessions/messages/settings/memory/logs` 五组 DAO + `health()` + `checkpoint()`。
- SQLite 实现（better-sqlite3，WAL；表结构见 01-architecture §3）；JSON 实现（同接口，
  `runtime-data/store.json`，原子写 tmp+rename）。启动探测 better-sqlite3 可加载 → sqlite，否则 json。
  **2026-10-14 双 ABI 落地**：Electron 下优先加载 `vendor/better-sqlite3-electron/`
  （官方 Electron v136 预编译，`node scripts/setup-electron-sqlite.mjs` 生成，npmmirror 镜像优先，
  verify 冒烟前自动 best-effort），Electron 运行时已实跑 sqlite（冒烟 selfcheck mode=sqlite）；
  vendor 缺失自动回退 json。首次切换时若存在旧 `store.json` 且新库为空 →
  `migrateJsonSnapshot` 一次性导入（apiKey 除外，仅 vault），旧文件改名 `store.json.pre-sqlite`。
- 打开失败（SQLITE_CORRUPT 等）：把库文件改名 `.corrupt-<ts>` 备份后重建，并返回
  `recovered:true` 供 UI 弹提示（对应 database-recovery-modal）。
- 迁移：首次启动若发现旧版 JSON（无此场景则跳过）——保留 `store.migrate()` 钩子
  （对齐其 localstorage-migration 的位置）。

**验证**：单元测试对两种实现跑同一套用例（参数化）：CRUD、损坏恢复、并发写；T03。

## F18 设置中心 / 自检 / 日志

**WorkBuddy 观察**：
- 设置面板族 chunks：`ModelsSettingsPanel`（模型配置）、`DataManagementPanel`（数据管理）、
  `SystemPermissionsPanel`、`ExtensionsSettingsPanel`、`LaboratoryPanel`、`SoftwareConfigPanel`。
- `main/self-check.js`（自检）、`workbuddy-server-logger.js` + `log-acl-guard.js`
  （日志与访问控制）、`crash-reporter.js`、`perf-metrics.node` + `process-cpu-sampler.js`。

**复现设计**：
- `app.selfcheck` 返回 `{store, pty, sandbox, skills, engine, appVersion, platform}`，
  UI 设置窗首页展示（对应其 self-check + SystemPermissionsPanel 的诊断定位）。
- 日志：daemon 统一 logger（level/scope），落 `runtime-data/logs/daemon-YYYYMMDD.log`，
  环形保留 7 天；UI 数据管理页可打开目录与清空。无任何外发（与 WorkBuddy 遥测的有意偏离，见 90-deferred）。
- 数据管理：导出会话 JSON、清空数据（二次确认）。

**验证**：单元测试 selfcheck 各字段；E2E 冒烟调用 `app.selfcheck` 断言关键字段非空；T18。
