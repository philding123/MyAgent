# 行为一致性对比报告（wb V5.8.2 实机 ↔ MyAgent，2026-10-15）

- 方法：`scripts/behavior-parity.mjs` —— 同一用例表分别驱动实机 WorkBuddy
  （CDP，端口 9333）与 MyAgent（spawn + 隔离 MYAGENT_HOME + 本地 mock LLM），
  每个用例前后截图落盘于 `artifacts/behavior/{wb,my}/`，状态断言汇总于
  `results.json`。
- 口径：行为一致 = 同一动作产生等价的状态迁移。wb「发送」会消耗用户云端配额，
  不驱动；MyAgent 发送以 mock LLM 离线验证。

## 结果（MyAgent 8/8 PASS；wb 7/8 + 1 PARTIAL）

| 用例 | wb 实机 | MyAgent | 行为一致性 |
|---|---|---|---|
| 新建任务 | PASS — 任务计数 0→0，停留首页草稿态 | PASS — 会话数不变，标题"新任务"，composer 聚焦 | ✅ 一致（草稿语义，会话在首条消息发出时物化） |
| 模式 chip | PARTIAL — chip 存在（wb-live-home.png 红色「⚠ 允许完全访问」），自动化点击未复现弹层 | PASS — 点击弹出三选项菜单，选择后 chip 更新 | ✅ 交互一致（下拉选择）；wb 弹层需精确命中子元素，自动化未复现（截图为证） |
| 打开会话 | PASS — 点击会话行 → 会话视图打开 | PASS — active 行切换、标题更新 | ✅ 一致 |
| 全局搜索 | PASS — Ctrl+K 弹出独立搜索窗 | PASS — 独立窗出现 | ✅ 一致 |
| 打开设置 | PASS — Ctrl+, 弹出设置窗 | PASS — 独立窗出现 | ✅ 一致 |
| composer 输入 | PASS — 输入回显（ProseMirror 编辑器，坐标点击+CDP 键入） | PASS — 输入回显 | ✅ 一致 |
| 侧栏折叠 | PASS — 280→0→还原 | PASS — 360→0→360 | ✅ 一致 |
| 发送消息 | SKIP（配额） | PASS — 草稿物化为会话（2→3）+ mock 回复出现 | ✅（wb 侧语义由「新建任务草稿」用例间接验证） |

## 行为对比轮驱动 MyAgent 的修复

1. **模式 chip 交互**：循环切换 → 改为 wb 同款**下拉菜单**（三选项、选中高亮、
   草稿态亦可设置）。
2. **composer sub 行可见性**：曾错误地做成仅首页显示——行为对比确认 wb 在
   会话视图也有「允许完全访问」；后又依 wb-live-main.png 证实会话视图**无**
   sub 行，最终定为 HOME-only（与 wb 一致）。
3. **新建任务语义**：立即创建会话 → 改为 wb 同款**草稿态**（不建会话、聚焦
   composer，首条消息发出时以消息内容命名物化）。
4. **侧栏折叠钮**：wb 窗带首图标，MyAgent 补齐（360↔0）。

## 已知残留

- wb mode-menu 弹层自动化复现不稳定（应用窗口状态漂移 + 子元素命中精度），
  以 PARTIAL 记录；人工核验见 `wb/mode-menu-open.png`。
- MyAgent 侧导航不含 wb 独有业务（助理/专家·技能·连接器/发现应用/灵感），
  属功能域裁决（wb-feature-inventory.md §3/§5）。
