# 33 · v5.8.2 真实 UI 对齐（F38，Phase 7）

> 背景：design/27 的像素基线取自 v5.7.7 asar **骨架屏**（实机当时被进程保护+
> 幽灵显示器阻断，取证见 `pixel-evidence/live-attempts.md`）。2026-10-15 实机
> WorkBuddy 已自动升级 **V5.8.2** 且可正常启动，CDP 直连成功
> （`scripts/pixel-shoot-wb-live.mjs` / `pixel-probe-wb-live.mjs`），拿到真实
> 渲染基线：`wb-live-{main,home,settings,search}.png` + `wb-live-tokens-*.json`。
> 人眼可见的巨大偏差即源于「骨架口径 vs 真实 UI」的基线错位——本轮以真实 UI 为准。

## wb 实测令牌（v5.8.2，CDP 实测值）

| 面 | 实测 |
|---|---|
| 主窗窗带 | **30px**，白底；左侧图标组（≈92px）+ 菜单标签 编辑(E)/窗口(W)/帮助(H)/关于(A)（12px, rgb(30,30,30)）；右侧 min/max/close |
| 侧栏 | **360px**，白底；品牌 WorkBuddy 14px/700 black/0.9 + 版本 V5.8.2 10px/50%；导航项 x12 w336 **h32 r8** fs13；分组标签 12px/600 black/50%（任务 (0)/空间 (3)）；底部用户行（头像+账号+铃铛/ monitor） |
| 主区顶栏 | **64px**（标题 + 搜索/分享/面板图标） |
| home hero | 标题「WorkBuddy, 我帮你」**30px/600** 居中；场景胶囊行 h32 r9999 fs14/600（办公=active 灰底）；chips 行 h32 **r100 bg#f7f7f7 border#dedede**；建议 chips h38 r9999 白底 border#e6e6e6 p8×16 |
| composer | 卡片 800px 居中（占位「今天帮你做些什么？@ 添加上下文，/调用技能与指令」；左下 +；右下 模型选择 13px + 麦克风 + **32px 圆形发送**）；卡下 选择工作空间 / 允许完全访问（红）；底部「内容由 AI 生成，请核实重要信息」 |
| 设置窗 | 白底；左导航：搜索框（h31 #f7f7f7 r8）+ 分组（设置/功能/数据与安全）+ 项 h32 r8 active 灰底；右内容 x≈248：节标题 13px/50% + **白卡行**（label+desc 左，select/switch 右） |
| 搜索窗 | 通栏输入（#f7f7f7 r8）；Tab 行 全部/任务/空间/产物/资料库（active 黑下划线）；空态 吉祥物+「输入关键字进行检索」；底部快捷条 ↑↓/↵/⇧⇥/ESC |

## MyAgent 映射（功能域对齐，不虚设死链接）

- 窗带：左侧 搜索图标（开全局搜索）+ 菜单标签 编辑(E)/窗口(W)/帮助(H)/关于(A)
  （点击 `menu.popup` 弹出 F35 原生菜单，结构重排为 wb 顺序）；右侧 min/max/close
  （主窗改 `frame:false`）。
- 侧栏 360px：品牌 MyAgent + 版本；导航=MyAgent 真实功能：新建任务 / 技能市场 /
  技能 / 记忆 / 全局搜索；分组：任务（无 cwd 会话）/ 空间（按 cwd 分组）；底部
  用户行：头像 M + 设置 + daemon 状态点。wb 独有功能（助理/专家/定时任务/资料库/
  发现应用/灵感）**不虚设**，记功能域偏差。
- 顶栏 64px：会话标题 + 模式切换（ask/plan/craft 映射「只读/计划/允许完全访问」）+
  搜索/终端/预览图标。
- home hero：标题「MyAgent, 我帮你」30px/600；场景胶囊（办公/开发/设计，active 灰底）
  + chips 行（wb 同款样式，MyAgent 场景集）；composer 卡片 800px（占位同款句式、+
  按钮、模型 chip 读 `llm.model`、模式 chip、32px 圆发送）；下 行 工作空间/模式 chip；
  建议 chips（点击回填输入）；免责声明行。
- 设置窗：白底 + 搜索框 + 分组导航（通用/模型与引擎/技能与市场/同步与沙箱/数据与
  安全…映射 MyAgent 既有 13 节）+ 白卡行化；frame:false + 既有 × 关闭。
- 搜索窗：通栏输入 + Tab（全部/任务/文件，MyAgent 实际域）+ 空态 + 底部快捷条。

## 验证方法与结果（2026-10-15）

- T29 断言升级为 v5.8.2 规格值：`ui-shell`（band 30 / sidebar 360）、`ui-main`
  （topbar 64）、`ui-settings`（nav 224）——实测通过。
- 像素（实机 CDP 截图降采样对齐后 pixelmatch；真实 UI 对真实 UI）：
  **main(home) 61.49% / settings 57.26% / search(conversation) 93.35%**。
  剩余差异 = 侧栏真实业务内容（空间/会话名/发现应用）与品牌文案（功能域边界，
  非样式偏差）；结构（窗带/侧栏/hero/composer/建议 chips/免责声明）已对位。
- 证据：`wb-live-*.png`（实机）、`my-*.png`、`diff-live-*.png`、
  `wb-live-tokens-*.json`。
