# 34 · 空间/定时任务/资料库/预设/上下文/产物卡片（F39–F44，Phase 8）

> wb 依据：v5.8.2 实机 UI（design/33 证据）——侧栏导航「新建任务/助理 BETA/
> 专家·技能·连接器/定时任务/资料库/更多」+ 空间分组（任务 (0)/空间 (3)）+
> composer 占位「@ 添加上下文，/调用技能与指令」+ 选择工作空间/允许完全访问 chip
> + 对话内产物卡片网格（db_load_signals.py 17.4 KB 等，`wb-live-main.png`）。
> MyAgent 映射到自身架构（daemon RPC + 引擎工具 + 设置面板），不虚设不可实现项。

## F39 空间（会话分组正式化）
- 会话新增 `space` 字段（`sessions.setSpace`）；分组键 = `space || basename(cwd)`，
  侧栏「空间」按其分组（Phase 7 已按 cwd 雏形，本轮正式化 + 计数）。

## F40 定时任务
- `app/daemon/tasks.js`：`createScheduler({ store, runSchedule, tickMs })`——
  调度持久化于 settings KV（`tasks.schedule.<id>`）；到点执行 `runSchedule`：
  确保会话（`⏰ name`）→ engine.start → userMessage(prompt)。
- daemon 方法：`tasks.create/list/remove/toggle`。渲染层：设置窗「定时任务」面板。

## F41 预设（助理）
- `app/daemon/presets.js`：`MYAGENT_HOME/presets/*.json`
  （{id,name,description,prompt}）；会话可绑 `preset`；`buildInit` 的 persona
  通道载入预设 prompt（persona 机制已存在，wb 的助理=系统提示预设）。
- daemon 方法：`presets.list/create/remove`；`sessions.setPreset`。

## F42 资料库
- `MYAGENT_HOME/library/`；daemon 方法 `library.list/add/remove`
  （add 从本机路径复制入库）；引擎新增工具 `library_list` / `library_read`
  （design/30 同款直读自家目录，沙箱外信任域，仅列/读）。

## F43 @ 上下文 / 技能调用
- composer `@` 按钮 → 选文件 → 插入 `@"路径"` 记号；发送时解析记号为
  `context` 数组（自由文本中的 @ 不受影响）；daemon `engine.userMessage`
  读取上下文文件（单个 ≤64KB）拼入发给引擎的文本——用户消息存储保持原文。
- `/` 按钮 → 技能列表 → 插入 `/技能名`（技能已由 F11 注入 system，此处为
  wb 同款的可见调用约定）。

## F44 产物卡片
- write_file 工具事件渲染为卡片式 chip（📄 文件名，点击 openPreview 预览）。

## 验证方法（T33–T37）
- T33 空间：setSpace 后 sessions.list 分组键正确（integration）。
- T34 定时任务：createScheduler 注入假 store/runner，intervalMs=40，300ms 内
  runner ≥2 次；remove 后不再执行。
- T35 预设：CRUD + 未知 read 返回 null。
- T36 资料库：add→list→工具读内容（engine makeTools({library}) 直测）。
- T37 上下文：augmentContext 拼接/超限/不可读三态。
- e2e：既有 T29–T32 回归（新面板不破坏现有断言）。
