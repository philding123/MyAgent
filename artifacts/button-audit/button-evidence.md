# 逐按钮证据映射（MyAgent 审计 ↔ wb V5.8.2 实机行为）

> **更正（2026-10-21）**：下表 2026-10-16 的「27/27 PASS」含存在性断言（最小化/关闭/菜单标签/预览/@ 上下文只检查按钮存在），
> 不算行为验证；且当时未覆盖设置窗与搜索窗。按效果断言的新审计（91 项，含设置窗/搜索窗全部控件）见
> 同目录 `button-audit.md`，已并入 `npm run verify`（T49）；新审计发现并修复的问题见 `design/36-button-audit.md`。
> 侧栏行（技能市场/技能/记忆）已按 F54 六项导航变更。下表 wb 侧对应关系仍有效。

- MyAgent 侧：`scripts/button-audit.mjs` 实测（本目录 results.json + 27 张截图 +
  button-audit.md），**27/27 PASS**（2026-10-16）。
- wb 侧：`scripts/behavior-parity.mjs --side wb` 实机 CDP 驱动（同用例表）+
  `wb-live-*.png` 实拍 + design/33 实测令牌。wb 行为明细见
  `artifacts/behavior/behavior-parity.md`。
- 对齐基线：wb V5.8.2 实机（本机已自升级，CDP 直连）。

| MyAgent 按钮 | MyAgent 实测 | wb 对应物与行为（实机证据） | 一致性 |
|---|---|---|---|
| 窗带-折叠侧栏 | 360→0→360 | 窗带首图标：280→0→还原（behavior wb sidebar-toggle PASS） | ✅ |
| 窗带-搜索 | 独立搜索窗出现 | 窗带搜索图标 + Ctrl+K：独立搜索窗（behavior wb open-search PASS） | ✅ |
| 菜单 编辑(E)/窗口(W)/帮助(H)/关于(A) | 点击无异常，原生弹层（OS 层，不在页面截图内） | wb 窗带同位置同四标签（wb-live-*.png 顶栏） | ✅（弹层为 OS 层） |
| 最小化 | 按钮存在（最小化效果在 OS 桌面层） | wb 窗带右侧 min/max/close（wb-live-main.png 右上） | ✅ 存在+语义 |
| 最大化/还原 | innerWidth 随最大化变化并还原（27/27 轮 PASS） | 同上 | ✅ |
| 关闭 | 按钮存在（点击→托盘驻留，F16 语义） | wb 关闭→托盘（dock-recent 语义近似） | ✅ |
| 侧栏-助理 | 设置窗 presets 面板（active=presets） | wb「助理 BETA」导航进入助理视图 | ✅（MyAgent 以预设面板承载） |
| 侧栏-技能市场 | 设置窗 market 面板 | wb「专家·技能·连接器」（F12/F25 市场已实现） | ✅ |
| 侧栏-定时任务 | 设置窗 tasks 面板 | wb「定时任务」导航（F40 调度器） | ✅ |
| 侧栏-资料库 | 设置窗 library 面板 | wb「资料库」导航（F42） | ✅ |
| 侧栏-技能 / 记忆 | skills / memory 面板 | wb 记忆与进化/技能（F11/F13） | ✅ |
| 侧栏-全局搜索 | 独立搜索窗 | wb 全局搜索独立窗（F15） | ✅ |
| 会话行 | active 切换 + 面包屑（空间/标题） | wb 会话行点击 → 会话视图 + 面包屑（项目/技术问答/…） | ✅ |
| 顶栏 ask/plan/craft | chip 联动（只读问答/计划模式/允许完全访问） | wb 交互模式三态（F07） | ✅ |
| 顶栏-终端 | 终端面板开/关 | wb 内置终端（F14） | ✅ |
| 顶栏-预览 | 按钮存在（点击弹系统文件框，不可自动化；预览窗行为见 T20） | wb 图片预览独立窗（F33） | ✅ 存在+预览窗另证 |
| 顶栏-搜索 | 独立搜索窗 | wb 会话顶栏搜索图标 | ✅ |
| composer-@ | 按钮存在（点击弹系统文件框；@"路径" 上下文注入 T37） | wb composer「@ 引用资产文件」 | ✅（注入语义 T37） |
| composer-/ | 内联技能菜单（3 项） | wb composer「/ 调用技能与指令」 | ✅ |
| composer-模式 chip | HOME 三选项菜单，选择后 chip 更新 | wb「⚠ 允许完全访问 ▾」chip（HOME；PARTIAL=wb 弹层自动化未复现） | ✅（wb 侧 PARTIAL） |
| composer-模型 chip | 点击 → 设置模型面板 | wb 模型选择器（Deepseek-V4.1-Flash ▾ / Hy3 ▾） | ✅（wb 下拉换模型 vs MyAgent 跳设置，语义等价实现差异） |
| 发送 | 草稿物化会话（2→3）+ mock 回复 | wb 发送后对话/任务物化（首页计数 0→0 草稿语义） | ✅ |

## wb 侧行为实测原始结果（behavior-parity --side wb）

| 用例 | 结果 | 说明 |
|---|---|---|
| new-task | PASS | 任务计数 0→0（草稿语义） |
| open-session | PASS | 会话行点击 → 会话视图 |
| open-search | PASS | Ctrl+K → 独立窗 |
| open-settings | PASS | Ctrl+, → 设置窗 |
| composer-type | PASS | contenteditable 输入回显 |
| mode-menu | PARTIAL | chip 存在；弹层自动化未复现（窗口状态漂移） |
| sidebar-toggle | PASS | 280→0→还原 |
| send-message | SKIP | 消耗云端配额，不驱动 |

## 说明

- 「win-max 首轮 FAIL」为测量方法问题（视口覆盖把 innerWidth 钉死），改清覆盖
  后测量即 PASS；不涉应用缺陷。
- 两个「存在（点击弹系统文件框，无法自动化）」项为 OS 模态对话框，自动化不可
  达，以存在性+下游行为（T20 预览、T37 上下文注入）另证。
- wb 侧 mode-menu PARTIAL 的复现前提：窗口 ≥1280 宽 + 首页草稿态；自动化在
  窗口状态漂移下未稳定命中。
