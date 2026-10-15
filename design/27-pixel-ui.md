# 27 · 像素级 UI 复刻（WorkBuddy → MyAgent）

> 目标：主窗/设置窗/搜索窗/预览窗的视觉表现与 WorkBuddy v5.7.7 像素级一致，
> 同时**排除全部支付/订阅 UI**（延续 00-roadmap「明确排除支付」决策）。
> 本文每条结论均标注 WorkBuddy 侧出处（文件 + 选择器/键名）。
> 分析基线：`D:\tools\workbuddy\install\resources\app.asar`
> （SHA-256 `035254bc76310ea46317433e4840602094543ef323d2d5c5aff7c131729de918`，
> @electron/asar 全量解包于 %TEMP%/wb-extract/app）。

## F29 设计令牌体系

**WorkBuddy 观察**（`renderer/assets/tokens-Df-i-zsO.css`，亮色 `:root` 块 1980 个变量、暗色覆盖 932 个）：

| 令牌 | 亮色 | 暗色 | MyAgent 采用 |
|---|---|---|---|
| radius 阶梯 | xs 2 / sm 4 / md 6 / lg 8 / xl 12 / full | 同 | `--radius-*` 同值 |
| spacing 阶梯 | 2,4,5,8,12,16,20,24,32,40,48,64 | 同 | `--sp-*` 同值 |
| 字号阶梯 | 12,13,14,16,18,20,24；body 14/22 | 同 | `--fs-*` 同值 |
| 字重 | 400/500/600/700 | 同 | 同 |
| 动效 | fast .15s / medium .2s | 同 | 同 |
| 品牌色 | `--wb-palette-brand-8` **#00c29a**（deep #087866，blue #0052d9） | 同 | `--brand` |
| 主文字 | `--wb-color-text-primary` ≈ #1f2329 | #fff | `--text-1` |
| 次文字 | `--wb-color-text-secondary` #646a73 | #ffffffa6 | `--text-2` |
| 页面底色 | content #fff（`--wb-bg-content:var(--wb-palette-white-100)`） | #1a1a1a | `--bg-content` |
| 侧栏底色 | #f7f7f8（index.html 骨架 `--sk-sidebar-bg`） | #1f1f1f | `--bg-side` |
| 灰阶 | gray-1 #fafafa / 2 #f7f7f7 / 3 #f2f2f2 / 4 #ebebeb / 5 #e6e6e6 | — | `--gray-*` |
| 填充 | hover #0000000f / active #0000001a（settings-window-perf 回退值） | 白系透明 | `--fill-hover/active` |
| 边框 | subtle #00000014；面板 border-card | #262626 | `--border` |
| 输入槽渐变 | `--wb-bg-input-slot-gradient:linear-gradient(180deg,#ebebeb,#f5f5f5)` | 灰阶 | composer 槽 |
| 基础字体 | `PingFang SC,-apple-system,...,"Segoe UI"` 13px（index.html body） | 同 | body 基准 |
| 滚动条 | 10px，thumb rgba(100,100,100,.4)（index.html） | 同 | 同 |

**复现设计**：style.css 以 `:root`+`[data-theme=dark]` 两套 CSS 变量完整复刻上表；
默认主题从 dark 切为 **light**（WorkBuddy 默认 IDE Light，index.html 注释明言
「默认主题是 IDE Light，不跟随 prefers-color-scheme」）。
暗色灰阶取 wb 暗色调色板精确值（tokens-Df-i-zsO.css）：gray-1 **#141414** /
gray-2 **#292929** / gray-3 **#1f1f1f** / gray-4 **#242424** / gray-5 **#3a3a3a**
（2026-10 像素对比轮修正了此前的近似值 #262626 等）。

**主题端到端（2026-10 补齐）**：设置页外观选择 → `rpc.window setTheme` →
主进程 `windows.setTheme`（缓存 + `rpc:event` `app:theme` 广播）+ 持久化
`appearance.theme`（daemon settings）；daemon ready 时回读恢复；四个页面启动
取 `rpc.window theme` 应用、并跟随 `app:theme`。验收：`ui-token-dark`
（dark 下 brand #4ecba0 / content #1a1a1a / side #1f1f1f / gray2 #292929）。

**验证**：T29-a 断言渲染窗 `getComputedStyle` 关键变量值与上表一致。

## F30 主窗布局

**WorkBuddy 观察**：

- 骨架屏（index.html，作者注释「布局参照真实 UI」）：titlebar 38px #f5f5f5；
  sidebar **220px** #f7f7f8 padding 12px 10px border-right rgba(0,0,0,.06)；
  新建任务钮 36px r8；导航项/会话项 28px r6；状态栏 22px #f8f8f8。
- 任务视图头（`project-detail-page-*.css` `.project-detail-view__header`）：
  **48px**、padding 0 20px、border-bottom 1px `--wb-border-card`、justify-between。
- 主页 hero（`contexts-*.css` `.wb-home-page`）：max-width 848px（宽屏 1008）居中、
  padding 0 24px、gap 32px；输入槽 `.wb-home-composer__input-slot`：radius **24**
  （内容 26/22）、min-height 50、padding 2px 2px 4px、背景渐变（见令牌表）。
- 聊天内容列（`agent-chat-pane-*.css` `.claw-agent-chat-pane`）：content max-width **832px**。
- 用户消息（`src-CyXHA0IC.css` `.cr-user-message-editor`）：contenteditable 15px/1.75、
  min-height 50、footer padding-top 12 gap 12。
- 场景标签（骨架 `.sk-content-tag`）：80×32 r16 胶囊；i18n 日常办公/代码开发/设计创意。
- UserMenu 触发器（`UserMenu-*.css` `.user-menu-trigger`）：圆钮 padding 4、radius 50%。

**复现设计**（index.html + app.js）：
- 壳层（骨架 `:root` 权威值）：全宽 **38px titlebar**（#f5f5f5，拖拽区）在顶、
  **22px statusbar**（#f8f8f8，右侧 daemon 状态点）在底，侧栏+内容夹在中间
  ——侧栏不再通顶（2026-10 像素对比轮修正）。
- 侧栏 220px：`#btn-new`（36px r8 主色描边）→「任务」分组标签 → `#session-list`
  （项 28px r6，active 用 gray-4）→ 底部 UserMenu 风格 `#btn-settings`（圆头像位 + 设置）。
- 任务视图头 48px：`#session-title`（14px/600）+ `#mode-switch` 胶囊组（ask/plan/craft，
  active 品牌色）+ terminal/preview/search 幽灵图标钮（28×28 r6）。
- 消息区：内容列 832px 居中；空会话时 `.home-hero`（品牌名 28px + 三枚场景胶囊），
  发送首条消息时移除；`.msg.user` → 15px/1.75 卡片 r12 border；`.msg.assistant` 全宽
  14px/22。
- **零会话启动 = wb home**：无任务头，hero 与 composer 垂直居中相邻
  （骨架 `.sk-content` justify-content:center；启动不再触发目录选择框）。
- Composer：外槽 r24 渐变 p(2,2,4) + 内卡 r22 白底（暗色 #1f1f1f）+ 右下品牌色发送钮。

> 骨架 bootstrap 细节：`skeleton-bootstrap.js` 在无 localStorage 时会把骨架侧栏
> 动态拉宽到 280px（`agent-ui-sidebar-width` 缺省回退 280）；本设计以作者提交的
> CSS 规格值 220px 为准（T29 断言同）。

**验证**：T29-b E2E：主窗加载后侧栏宽 220、顶栏高 48、hero 存在；发送后 hero 消失。

## F31 设置窗（WorkBuddy 布局，MyAgent 功能项）

**WorkBuddy 观察**（`settings-window-perf-ILa933LI.css` + `contexts-*.css`）：

- 窗口 chrome `.settings-window-chrome`：32px、drag、Windows 靠右；
  关闭钮 `.settings-window-close` 24×24 r6、色 #646a73、hover #0000000f。
- 窗体尺寸 **900×680**（`main/window-apps.js` 中 settings 窗 BrowserWindow 参数）。
- 导航 `.settings-modal__nav`：宽 **200px**、padding 40/12/16、gap 2、bg secondary；
  导航项 `.settings-navigation__item`：padding 5px 12px、r8、14px、
  active 背景 `--wb-color-bg-primary-hover`（gray-4）。
- 面板 `.settings-window-panel`：max-width 520、padding 24、gap 12、文字 #646a73；
  面板标题 `.settings-modal__title` 16px/500 PingFang SC。

**复现设计**（settings.html + settings.js）：chrome(32px+关闭) + 左 nav 200px +
右面板列，窗底色 `--wb-bg-secondary`（令牌链解析 = `--wb-palette-gray-2`
**#f7f7f7**），nav 透明覆盖其上、内容列白底。MyAgent 现有 13 个 section 映射为
导航分组：模型 / 外观 / 引擎 / 更新 / 技能市场 / 同步 / 云沙箱 / A2A / 技能 /
记忆 / IM 通道 / 自检 / 数据管理。所有现有 input id 原样保留（settings.js 不动逻辑，
只加导航切换与关闭）。

**验证**：T29-c E2E：设置窗 nav 200px、点击分组切换面板、关闭钮可关窗。

## F32 全局搜索窗

**WorkBuddy 观察**（index.html `.sk-global-search-*` + 独立窗 800×640 注释）：
顶部 drag 带 20px；输入框 40px r8 bg rgba(0,0,0,.04)（暗 rgba(255,255,255,.06)）；
空态居中 spinner 20px。窗体 800×640。

**复现设计**（search.html + windows.js 尺寸 720×520→**800×640**）：
drag 带 + 大输入框（40px r8，bg rgba(0,0,0,.04)，margin 8/16）+ 结果卡片列表
（r8 卡片、file/message 标签胶囊）+ **空态 20px spinner 居中于输入带下方区域**
（骨架 `.sk-global-search-body`；有结果后隐藏）。

**验证**：T29-d E2E：搜索窗尺寸与输入框高度。

## F33 预览窗

WorkBuddy 图片预览窗骨架（`?windowKind=image-viewer`，bootstrap 建窗）：
底色 **#f2f2f2** 整窗（index.html `.sk-image-viewer-loading`）+ 32px 顶部拖拽带 +
居中 20px spinner（`.sk-image-viewer-body/-spinner`）。
MyAgent 复现：窗体/顶栏/内容区统一 `--gray-3`（#f2f2f2）底，顶栏 32px 同底色
（承载标题 + kind 徽标胶囊），内容卡片（.preview-text/.docx-host/.pdf-page）白底
承载真实文件。窗尺寸 980×720（wb 侧为 utility 预设无字面量，两侧统一取此值）。

## 支付/订阅 UI 排除清单（复刻时不得出现）

WorkBuddy 侧全部支付面（枚举自解包产物，共 477 处命中收敛为 7 个 UI 面）：

| # | WorkBuddy UI 面 | 出处 | MyAgent 处置 |
|---|---|---|---|
| 1 | UserMenu 内 billing 摘要格 | `UserMenu-CpHz-0rF.css` `.user-menu-billing-summary/__cell` | 不复刻；UserMenu 仅保留设置入口 |
| 2 | 积分加购弹窗（1000 积分/包步进器） | 同上 `.addon-purchase-modal/__stepper`；`UserMenu-avAzOfpg.js` `creditsPerPack:1e3` | 不复刻 |
| 3 | 「套餐与积分」订阅面板 + 取消续费对话框 | `SubscriptionUsagePanel-Bc2Yohmb.js`；i18n `settings.nav.subscriptionUsage` | 设置导航不出现该项 |
| 4 | 个人主页积分区/升级套餐/管理套餐/购买积分 | `AccountPanel-CZmDTMfc.js` `AccountCreditsSection`；i18n `account.upgrade/subscriptionManage/buyCredits` | 不复刻（无账号体系） |
| 5 | 积分不足横幅 + 立即购买 | `credits-insufficient-bar-DEgPDFQM.js`（credit_low_5/0）；i18n `errorBanner.action.purchase` | 不复刻 |
| 6 | 邀请好友赚积分（+100） | i18n `conversation.inviteFriends.*`、`inviteCredits.*` | 不复刻 |
| 7 | 微信支付扫码/模块 | i18n `weixinpay.*`；`plugins/weixinpay`、`wechatpay-cli.exe`、`subscription-gate`（design/90-deferred 已记录） | 不复刻 |

**红线**：MyAgent 渲染层不得出现「套餐/积分/充值/订阅/购买/收银台/微信支付」
任何 UI 入口；T29-e 在四页 DOM 文本中反查这些关键词（含「升级套餐」）断言为 0。

## 验证方法汇总（T29 系列，进 verify）

- T29-a 令牌：主窗 computed style 关键变量 = 本文令牌表值。
- T29-b 壳层：侧栏 220px / titlebar 38px / statusbar 22px。
- T29-c 任务视图：经 `window.__myagentTest.openSession` 打开会话后顶栏 48px /
  hero 出现与移除。
- T29-d 设置窗：nav 200px / 面板切换 / 关闭。
- T29-e 搜索窗：尺寸 800×640 / 输入框 ≥40px。
- T29-f 预览窗：内容区 980×720（`useContentSize`）/ 顶栏 32px / 底色 rgb(242,242,242)。
- T29-g 暗色令牌端到端：真实链路 setTheme(dark) 后 brand #4ecba0 / content
  #1a1a1a / side #1f1f1f / gray2 #292929。
- T29-h 支付排除：主/设置/搜索/预览四窗 innerText 无支付关键词（smoke 打开
  share-sample.txt 预览窗一并扫描）。

## 像素级截图证据（2026-10 对比轮）

WorkBuddy 基线 = asar 骨架屏（作者注释「布局参照真实 UI」；实机捕获不可行的
取证见 `artifacts/pixel-evidence/live-attempts.md`——进程保护 + 幽灵显示器冻结面）。
两侧同视口、`force-device-scale-factor=1`、动画禁用，pixelmatch 对比：

| 面 | 视口 | match | 证据 |
|---|---|---|---|
| main | 1280×800 | 93.86% | wb-main/my-main/diff-main.png |
| settings | 900×680 | 27.37%（骨架=加载态整窗灰底，无导航/面板，几何以 ×/chrome 对齐为准） | wb-settings/my-settings/diff-settings.png |
| search | 800×640 | 94.08%（余量=placeholder 文字） | wb-search/my-search/diff-search.png |
| preview | 980×720 | 94.42%（余量=真实文件内容 + spinner 描边） | wb-preview/my-preview/diff-preview.png |
| search-dark | 800×640 | **99.88%**（除 spinner 描边 AA 逐像素一致） | wb-search-dark/my-search-dark/diff-search-dark.png |
| settings-dark | 900×680 | 27.37%（与亮色同口径；backdrop #292929 已对齐） | wb-settings-dark/my-settings-dark/diff-settings-dark.png |
| main-dark / preview-dark | — | 无 wb 暗骨架可比，出 MyAgent 真实链路渲染证据（my-main-dark/my-preview-dark.png） | — |

复现：`node scripts/pixel-shoot-wb.mjs && node scripts/pixel-shoot-my.mjs &&
node scripts/pixel-compare.mjs`；报告见 `artifacts/pixel-comparison.md`。
