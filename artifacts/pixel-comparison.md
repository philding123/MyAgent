# MyAgent ↔ WorkBuddy 像素级对比报告（F29–F33 证据落盘）

> **2026-10-15 真实 UI 轮（当前口径）**：实机 WorkBuddy 已自动升级 **V5.8.2** 且
> CDP 直连成功，像素基线由 v5.7.7 骨架屏升级为**真实渲染 UI**（此前骨架口径的
> 数字保留于下文作历史）。实机 CDP 采集：`scripts/pixel-shoot-wb-live.mjs` /
> `pixel-probe-wb-live.mjs`，证据 `wb-live-*.png` + `wb-live-tokens-*.json`。
> 真实 UI 对比（降采样对齐后 pixelmatch）：**main(home) 61.49% / settings
> 57.26% / search 93.35%**——结构（窗带 30/侧栏 360/顶栏 64/hero/composer 卡/
> 建议 chips/免责声明）已对位；剩余差异为侧栏真实业务内容与品牌文案（功能域
> 边界，见 design/33）。T29 断言同步为 v5.8.2 规格值（band 30/side 360/top 64/
> nav 224）。

- 生成时间：2026-10-14（本轮会话）
- 基线：WorkBuddy v5.7.7 `D:\tools\workbuddy\install\resources\app.asar`
  （SHA-256 `035254bc76310ea46317433e4840602094543ef323d2d5c5aff7c131729de918`，
  全量解包于 `%TEMP%\wb-extract\app\`）
- 对比对象：MyAgent 真实运行窗口（隔离 `MYAGENT_HOME` + CDP 截图）
- 工具链：`scripts/electron-shot.js` + `scripts/pixel-shoot-wb.mjs`（基线）、
  `scripts/pixel-shoot-my.mjs`（MyAgent）、`scripts/pixel-diff.mjs`（pixelmatch 0.1 阈值）、
  `scripts/pixel-compare.mjs`（汇总）
- 结论速览：**main 93.86% / search 94.08% / preview 94.42% / settings 27.37% /
  search-dark 99.88% / settings-dark 27.37%**；另存 main-dark/preview-dark
  真实链路渲染证据（wb 无暗骨架可比）；
  剩余差异全部为「真实内容 vs 占位骨架」或「刻意排除面」，逐项见下文偏差清单。

## 一、为什么用骨架屏作 WorkBuddy 基线（方法与限制）

实机 WorkBuddy 捕获在本机不可行，证据如下（原始输出已存
`artifacts/pixel-evidence/live-attempts.md`）：

1. 进程保护：`taskkill /F` 与 `Stop-Process -Force` 对全部 WorkBuddy 进程返回
   「拒绝访问」（含子进程），无法带 `--remote-debugging-port` 重启 → CDP 不可用；
2. 幽灵显示器：主窗位于 X=2549（超出当前 3840px 桌面），`MoveWindow` 被拒、
   Win+Shift+方向键 拉回后内容仍是冻结纯蓝面（`wb-live-1576070-WorkBuddy.png`，
   DWM 缩略图同样只给冻结占位 `wb-1576070-WorkBuddy.png`）——渲染面不可恢复。

因此基线改用 **WorkBuddy 自带的渲染器骨架屏**：`renderer/index.html` 内嵌骨架
DOM+CSS，作者注释明言「布局参照真实 UI」（design/27 F30 引用），配合
`skeleton/skeleton-bootstrap.js` 的窗口分发机制：

| 面 | 渲染方式 | 视口 | 出处 |
|---|---|---|---|
| main | index.html，JS 禁用（CSS 权威值 `--sk-sidebar-w:220px`） | 1280×800 | index.html `:root`（38/220/22、#f5f5f5/#f7f7f8/#f8f8f8） |
| settings | `?windowKind=settings&colorScheme=light`，bootstrap 经典脚本建 DOM；React 模块因 file:// CORS 不加载，骨架留存 | 900×680 | bootstrap 源码 + `main/window-apps.js`（窗尺寸 900×680） |
| search | `?windowKind=global-search`，同上 | 800×640 | bootstrap 源码 + `window-apps.js`（800×640）+ index.html 骨架 CSS（输入带 margin 8/16、高 40、r8、bg rgba(0,0,0,.04)、居中 20px spinner） |
| preview | `?windowKind=image-viewer`，同上 | 980×720 | bootstrap 源码 + index.html 骨架 CSS（`.sk-image-viewer-loading` 底色 #f2f2f2、32px 拖拽带、居中 20px spinner）；wb 侧为 utility 预设无字面量尺寸，两侧统一用 MyAgent 预览窗尺寸 |

两侧同用 Chromium 渲染、`force-device-scale-factor=1`（1 CSS px = 1 PNG px）、
动画禁用且移除 shimmer 覆盖层（加载动画不属于布局，且会把随机帧烧进基线）。

已知口径偏差（记录，不计入布局对齐）：
bootstrap 在无 localStorage 时会把骨架侧栏动态拉宽到 280px
（`skeleton-bootstrap.js`：`agent-ui-sidebar-width` 缺省回退 280）；本基线以作者
提交的 CSS 规格值 220px 为准（main 面 JS 禁用即得），design/27 F30 与 T29 亦按 220。

## 二、逐面对比结果

证据文件均在 `artifacts/pixel-evidence/`（wb-*.png 基线、my-*.png 本实现、
diff-*.png 差异图、comparison.json 数值）。

| 面 | 视口 | 修复前 match | 修复后 match | diff 图 |
|---|---|---|---|---|
| main | 1280×800 | 16.92% | **93.86%** | diff-main.png |
| settings | 900×680 | 0.53% | **27.37%** | diff-settings.png |
| search | 800×640 | 94.07% | **94.08%** | diff-search.png |
| preview | 980×720 | 0.29% | **94.42%** | diff-preview.png |
| search-dark | 800×640 | — | **99.88%** | diff-search-dark.png |
| settings-dark | 900×680 | — | **27.37%**（与亮色同口径） | diff-settings-dark.png |

### 暗色面（F29 暗色令牌表的像素证据）

- wb 侧暗基线：`PIXEL_SHOT_DARK=1` → `nativeTheme.themeSource='dark'`
  （`--force-dark-mode` 在 Electron 不改变 prefers-color-scheme）；settings 骨架
  走 `sk-settings-loading--dark`，search 骨架走 prefers-color-scheme 媒体块；
- MyAgent 暗色灰阶已对齐 wb 暗色调色板精确值（gray-1 #141414 / gray-2 #292929 /
  gray-3 #1f1f1f / gray-4 #242424 / gray-5 #3a3a3a，tokens-Df-i-zsO.css）——
  修正了原 #262626 等近似值；
- **search-dark 99.88%** 为全链最强单点：除 spinner 描边抗锯齿外逐像素一致；
- settings-dark 27.37% 与亮色同口径（wb 侧只有整窗灰底加载骨架；backdrop
  #292929 与 chrome/× 已对齐，差异=真实内容列）；
- main-dark/preview-dark：wb 无暗骨架可比（main 骨架刻意恒亮——index.html 注释
  「默认主题是 IDE Light」；image-viewer 骨架无暗色块），故为 MyAgent 真实链路
  渲染证据（`rpc.window setTheme` → 持久化 + `app:theme` 广播 → 各窗自应用），
  暗色值由 `ui-token-dark` 断言锁定（brand #4ecba0 / content #1a1a1a /
  side #1f1f1f / gray2 #292929，与 wb 暗色令牌表一致）；
- 本轮同步修复了暗色主题端到端断裂：主题此前不持久化、广播走裸 `appearance`
  通道无人消费——现已改为 daemon settings 持久化 + `rpc:event app:theme`
  （契约表已更新），四页面启动取主题并跟随广播。

### main（主窗，空态 home）

修复项（本轮落地，均以骨架 CSS/`window-apps.js` 为源）：
- 全宽 **38px titlebar**（#f5f5f5，拖拽区）+ 底部 **22px statusbar**（#f8f8f8）；
  侧栏/内容夹在两者之间——此前侧栏通顶、无状态栏。
- **零会话启动 = wb home**：无任务头，hero（品牌名 28px + 三枚场景胶囊）
  与 composer 垂直居中相邻；修复了启动时误走 `newSession()` 弹目录选择框、
  导致 hero 缺失的 bug。
- 设置窗尺寸 880×640 → **900×680**（`window-apps.js` settings 窗参数）。

有意保留的差异（内容 vs 占位，diff 图中呈红但几何对齐）：
- 骨架用灰块占位（标题块 200×32、标签块 80×32、输入块 560×120），MyAgent 是
  真实内容（文字标题、胶囊文字、渐变 composer 槽 848——真实宽度来自
  design/27 F30 引用的 `.wb-home-page` max-width 848，560 只是占位）；
- wb 骨架侧栏含 5 条导航占位（助理/项目/专家/自动化/更多）与会话占位行——
  对应功能不在 MyAgent 范围（design/00-roadmap 明确的功能取舍）；
- statusbar 右侧的 daemon 状态点为 MyAgent 功能件，wb 骨架为空。

### settings（设置窗，900×680）

- chrome 32px + 右上关闭钮 24×24 r6 #646a73（diff 图中 × 位置完全重合）；
- 窗底色 → `--wb-bg-secondary`（= `--wb-palette-gray-2` **#f7f7f7**，令牌链
  tokens-light.json 逐级解析），nav 透明覆盖其上，内容列白底；
- **27.37% 的结构性原因**：wb 侧可渲染的只有「加载骨架」（整窗灰底 + ×），
  无导航/面板；MyAgent 侧是已加载的真实设置（nav 13 项 + 表单）。白/红分界线
  即 nav 200px + 内容列边界，几何与 design/27 F31 引用的
  `.settings-modal__nav`（200px）一致，由 T29-c `ui-settings` 断言锁定。

### search（全局搜索窗，800×640）

- 输入带几何逐值对齐（padding 8/16、高 40、r8、bg rgba(0,0,0,.04)），
  diff 中除文字带外全白；
- 空态 **20px spinner** 已按骨架居中于输入带下方区域（修正前偏在 y≈78，
  现与 wb 的 y≈354 重合，diff 仅余抗锯齿描边）；
- 剩余差异 = 输入框 placeholder 文字（真实应用行为）+ spinner 描边 AA。

### preview（预览窗，980×720）

- 窗体底色对齐 wb image-viewer 骨架的 **#f2f2f2**（--gray-3）：窗体、顶栏、内容区
  统一灰底；顶栏从 40px 白底+边框改为 **32px 同底色**（对齐骨架 32px 拖拽带）；
  内容卡片（.preview-text/.docx-host/.pdf-page）保持白底承载真实文件内容；
- diff 图中剩余差异 = 顶栏真实标题/kind 徽标文字 + 内容文字卡片 + spinner 描边
  抗锯齿（wb 的 20px spinner 与内容区中心重合，y≈375）；
- MyAgent 侧经 `rpc.window openPreview` 打开 `tests/fixtures/share-sample.txt` 截取。

## 三、支付/订阅排除证据（红线复核）

- 程序化断言：T29-e `ui-paywall-zero` —— 主/设置/搜索/预览**四窗** DOM innerText
  反查「套餐/积分/充值/订阅/购买/收银台/微信支付」= 0 命中（smoke 现以
  `windows.createPreview` 打开 share-sample.txt 后一并扫描，补齐 design/27 的
  「四页」口径；本报告同轮 verify 全绿）；
- 本轮截图（my-main/my-settings/my-search）肉眼复核无任何支付入口；
- 排除清单 7 面的 WorkBuddy 侧出处维持 design/27「支付/订阅 UI 排除清单」。

## 四、复现方法

```bash
npm run build                                   # 渲染层产物
node scripts/pixel-shoot-wb.mjs                 # 出 wb-*.png（需 %TEMP%/wb-extract）
node scripts/pixel-shoot-my.mjs                 # 出 my-*.png（隔离 MYAGENT_HOME）
node scripts/pixel-compare.mjs                  # 出 diff-*.png + comparison.json
npm run verify                                  # T01–T29 全绿门（含 ui-shell）
```

## 五、与验收的映射

- T29 断言已扩展：`ui-shell`（side 220 / titlebar 38 / statusbar 22）+
  `ui-main`（任务视图 topbar 48 + hero 互斥）+ `ui-preview`（980×720 内容区、
  32px 顶栏、rgb(242,242,242) 底色；预览窗 `useContentSize` 使内容区=设计尺寸），
  见 `scripts/verify.mjs` T29 映射；
- 本报告、wb/my/diff 截图与 comparison.json 共同构成 F29–F33 的像素级证据链；
  design/27 仍是每条取值的 WorkBuddy 侧出处（文件+选择器）。
