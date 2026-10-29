# 42 · 文件历史/回滚（F58 / T54）

状态：2026-10-29 立项（P16）并于同日实施完成（阶段 1–4 一轮完成）；验收以 acceptance-report 为准。

## 实施裁决（2026-10-29，随实现落定）

- **索引形态**：每路径一目录 `<filehistory>/<sha256(path)[0:32]>/`，内含 `index.json` + `<seq>.bin`。
  未走 sqlite 表：个人规模（百级文件 × 10 版本）下单路径 JSON 足够，免去 better-sqlite3
  双 ABI 机器，删目录即删整个文件历史；「sqlite 不可用降级 json」的原表述由
  「单一 json 形态 + 接口不变」取代。
- **方法面为四个**（立项时三个）：UI 逐行对比需要服务端出 diff（内容不出 daemon），
  增加 `files.history.diff {path, versionId}`；文本走 LCS（前置/后缀裁剪 + 25 万格上限，
  超限返回计数），二进制返回 `{binary:true}` 只可恢复。
- **同轮去重**：daemon `recordEngineEvent` 以「thinking 开始一轮」为界，同轮同路径只快照
  一次；新的一轮再写同一文件会再次快照。
- **审计项 id**：`file-history`（`artifact-history` 已被"切换会话恢复产物"占用）。


## WorkBuddy 观察（app.asar 静态证据，2026-10-29）

- **云端服务形态**：`FileHistoryService.listFileHistory` 经 `httpClient.post`
  调**服务端**接口（`file_id` 必填、marker 分页、返回 `total_num/has_more` 与
  版本条目 `normalizeVersionItem`）；`restoreFile` / `deleteFileHistory` 同族。
- **配置面**：`enable_file_history`（开关）、`file_history_count`（每文件保留
  版本数）、`file_history_expire_day`（过期天数），`setHistoryConfig` 可写回。
- **写入侧通道**：harness 环境变量表含 `_codebuddy.ai/file_history_snapshot`，
  `FileHistoryTracker` 在写路径上打快照。
- **结论**：wb 的版本存储在腾讯云端，个人复刻不可能同形态。本地等价能力 =
  **写入时本地快照 + 版本浏览 + 一键恢复**，配置语义沿用 wb 三键。

## 复现设计（本地版本快照）

### 记录（阶段 1）

- **快照点**：daemon 侧文件工具**成功落盘后**对目标文件取快照——write_file
  成功、present_file 交付复制后；同一轮工具调用同一文件只取一次（路径归一化去重）。
- **快照内容**：文件字节（独立 `.bin`）+ 元数据（sha256、size、mtime、来源
  sessionId/tool、时间戳）；索引走 openStore 同模式（倾向 sqlite 表，字节不入库；
  sqlite 不可用降级 json 索引，接口不变）。
- **配置（settings，非凭证类）**：`fileHistory.enable`（默认开）、
  `fileHistory.count`（每文件保留版本数，默认 10）、`fileHistory.expireDays`
  （默认 30）；清理在 daemon 启动与每次写入后惰性执行。
- **预算护栏**：单文件快照上限 10MB（超过跳过并记 skipped，不阻断主写入——
  快照 best-effort，失败仅日志）；总存储上限 200MB，超限按最旧淘汰。
- **存储位置**：`%APPDATA%/myagent/filehistory/`（`MYAGENT_HOME` 可覆盖）。

### 恢复与管理（阶段 2）

- **daemon 方法**（唯一注册处 `app/daemon/index.js` methods，窄 IPC 不变）：
  - `files.history.list {path}` → 版本列表（新→旧，带元数据）
  - `files.history.restore {path, versionId}` → 快照写回目标路径；**覆盖前对
    当前内容先打一条"恢复前"快照**，保证恢复本身可撤销
  - `files.history.delete {path, versionId?}` → 删单版本或整文件历史
- **沙箱关系**：恢复=写操作，目标路径必须在 workspace 内（复用沙箱规则校验），
  越界 fail-safe 拒绝；restore 是用户在 UI 上的确定性动作，与产物"复制路径/打开
  所在文件夹"同级（本机安全操作，不走 120s 确认门），但 UI 覆盖前弹确认对话框。

### UI（阶段 3）

- 产物面板（F55 既有交付面）产物项操作区新增「历史版本」→ 版本列表
  （时间、来源工具、大小）+ 选中预览（文本类做当前 vs 选中版本的 diff）+
  「恢复此版本」；恢复成功后刷新产物与消息区提示。
- 首轮只做产物面板入口；band 菜单/预览窗入口不做。

### 不做（本轮边界）

- 二进制 diff（图片/office 只回滚不对比）。
- 跨设备同步版本历史（F26 不动）。
- 全盘监视：只记录 MyAgent 自己的写入，不监听用户手动编辑（wb 云端同样只记任务内写入）。

## 验证方法（T54）

| 层 | 断言 |
|---|---|
| unit | 快照记录与同轮去重；count/expire 淘汰；10MB/200MB 护栏（跳过与 FIFO）；sha256 校验；restore 先打恢复前快照；越界路径拒绝；快照失败不阻断写入 |
| int | files.history.list/restore/delete RPC 往返 + 真实文件字节回滚 + 惰性清理 + sqlite/json 双实现一致 |
| e2e/UI | 产物面板版本列表渲染、diff 预览、恢复后文件内容变化；按钮审计新增「历史版本/恢复」项 |

## 阶段排期（P16，按序执行，每阶段独立可停）

| 阶段 | 优先级 | 交付 | 验收 |
|---|---|---|---|
| 0 证据与契约 | ✅ 立项完成 | 观察（本节）+ 契约定名（files.history.* 方法、settings 三键） | — |
| 1 记录 | ✅ 2026-10-29 | 快照存储 + 写入挂钩 + 配置/惰性清理 | unit 13 用例全绿 |
| 2 恢复 | ✅ 2026-10-29 | RPC 四方法（含 diff）+ 沙箱约束 + 恢复前快照 | int 5 用例全绿 |
| 3 UI | ✅ 2026-10-29 | 产物面板历史/恢复 + 文本 diff | 按钮审计 `file-history`（103 项含新项） |
| 4 收口 | ✅ 2026-10-29 | 全量 verify ALL GREEN + 验收报告 | acceptance-report |

## 降级 / 边界

- sqlite 缺失时索引降级 json（openStore 同模式）；字节文件始终独立存放。
- 快照为 best-effort：任何快照/清理失败不阻断文件工具主流程，仅记日志。
- 版本条目不可跨 workspace 迁移解释（路径即身份，与产物中心 path-only 语义一致）。
