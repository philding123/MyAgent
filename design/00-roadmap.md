# MyAgent 实施路线图（对标 WorkBuddy）

> 目标：为个人使用复刻腾讯 WorkBuddy（`@genie/workbuddy-desktop` v5.7.7）的核心能力，
> **不含支付/订阅系统**。所有源码与产物在本目录（`myagent/`）下；本文件是总路线图与验收索引。
>
> 逆向证据基线：本机安装于 `D:\tools\workbuddy\install\`（Electron 37，asar 213MB，10935 个 JS 源）。
> 所有"WorkBuddy 观察"条目均标注证据路径，验证方法见 `99-test-plan.md`。

## 一、范围裁决（Scope）

| 类别 | 决定 |
|---|---|
| 支付/订阅（weixinpay、subscription-gate、credits） | **明确排除**（用户要求） |
| 腾讯专有服务（ImSDK、TuringShield、qimei、腾讯文档 editor_sdk、drive-sdk、COS） | **延后**：闭源 SDK 无法获得；在 `90-deferred.md` 记录替代路线 |
| IM 通道（微信/企微/飞书/钉钉/Slack/Discord/Telegram/QQ/Teams/元宝） | **Phase 3**：协议公开的平台（Slack/Discord/Telegram/飞书/钉钉）可复现，需个人 token |
| 云沙箱（e2b）、browser-use、Edge Sync 云端 | **Phase 3/4** |
| Phase 1（本次实施）核心：壳/守护进程/RPC/引擎/工具/模式策略/沙箱/技能/记忆/终端/搜索/设置/渲染/可靠性 | **本次实施并验收** |

**验收口径**：Phase 1 的 18 个功能点全部通过 `99-test-plan.md` 对应的自动化/手工测试，
且每项与设计文档中记录的 WorkBuddy 行为描述一致；出现偏差时按
「方案设计问题 / WorkBuddy 理解问题」归因并回改，直至对齐。
Phase 2-4（F19–F28，仍排除支付）沿用同一口径：T19–T28 全绿 + 真实 token/注册类
外部项按各设计文档「验证方法·手工」清单执行。
Phase 5（F29–F33，design/27-pixel-ui.md）：渲染层像素级对齐 WorkBuddy（令牌/主窗/
设置窗/搜索窗/预览窗），T29 八断言（ui-token/ui-shell/ui-main/ui-settings/
ui-search/ui-preview/ui-token-dark/ui-paywall-zero）进 verify；支付 UI 排除清单见
design/27 §「支付/订阅 UI 排除清单」。全量功能对照（wb 13 域 × MyAgent 覆盖 +
偏差 D1–D9 + 修复计划）见 `artifacts/wb-feature-inventory.md`。
Phase 6（P6 补面）：F34–F36 已实现并验收（T30–T32，2026-10-15）；F37（会话独立窗）P2 观察。
Phase 7（P7 真实 UI 对齐）：F38 已完成（实机 CDP 基线，2026-10-15）——本机 WorkBuddy 已自动升级 V5.8.2，design/27 的 v5.7.7 骨架基线由实机 CDP 基线取代（骨架口径数字保留于 pixel-comparison.md 作历史）。

## 二、功能点总表（F01–F18）

| ID | 功能点 | WorkBuddy 对应物（证据） | 阶段 | 设计文档 | 状态 |
|---|---|---|---|---|---|
| F01 | 桌面壳与多窗口框架 | `main/module.desktop-host.js`、`builtin-window-apps/independent-window/settings-window-app` chunks | P1 | 13-desktop.md | ✅ |
| F02 | 常驻守护进程 + 统一 RPC 总线 | `main/daemon-bootstrap.js`（`wb:invoke`、`invoke:request/response`、`conversations:snapshot`） | P1 | 11-daemon-rpc.md | ✅ |
| F03 | 会话持久化（SQLite，WAL，恢复） | `app-server-database.js`、`wal-checkpoint-worker.js`、`database-recovery-modal`、better-sqlite3 依赖 | P1 | 14-data.md | ✅ |
| F04 | Agent 执行引擎（headless 子进程，JSON 流协议） | `@genie/agent-cli` bin/codebuddy + `dist/codebuddy-headless.js`；`main/cli-process-env.js` | P1 | 10-agent-core.md | ✅ |
| F05 | 进程预热池 | `main/cli-prewarm-pool.js`（prewarm entry、sessionId 激活、自动补货） | P1 | 10-agent-core.md | ✅ |
| F06 | 内置工具集（读/写/列目录/跑命令/搜索） | CLI 依赖（ripgrep vendor、node-pty、`@anthropic-ai/sandbox-runtime`）与 prompt 片段 `tool-use.md` | P1 | 10-agent-core.md | ✅ |
| F07 | 交互模式与工具策略（ask=只读 / plan / craft） | `plugins/workbuddy-builtin/interactionmode/ask/fragments/current-mode.md`（硬规则）、`prompt.tpl`（nunjucks 按 workMode 装配） | P1 | 10-agent-core.md | ✅ |
| F08 | 文件沙箱规则（凭证硬拒 + 白名单放行） | `cli/vendor/sandbox/5.7.10/tsbx_rules.json`（deny `~/.ssh`、`~/.gnupg`；allow 缓存目录） | P1 | 12-security.md | ✅ |
| F09 | 命令确认（危险命令需批准） | 交互模式 tool-policy + `SecurityCenterPanel`/`SystemPermissionsPanel` | P1 | 12-security.md | ✅ |
| F10 | 凭证保护与落盘加密 | `main/credential-protection.js`、`@genie/at-rest-crypto`、`file-authentication-storage.js` | P1 | 12-security.md | ✅ |
| F11 | 技能系统（SKILL.md + 热装载） | `plugins/workbuddy-builtin/skills/*/SKILL.md`（YAML frontmatter：name/description/allowed-tools/disable）+ `skills-panel/skill-picker` chunks | P1 | 13-plugins.md | ✅ |
| F12 | 技能市场（本地导入版） | `.codebuddy-plugin/marketplace.json`（unified builtin marketplace）、`skills-market` chunk、`marketplace-skill-installer` | P1 | 13-plugins.md | ✅ |
| F13 | 记忆与个人化 | `MemorySettingsPanel`、`PersonalizationPanel`、`local-skills-memory` chunk | P1 | 13-plugins.md | ✅ |
| F14 | 内置终端（PTY） | node-pty + ConPTY（`OpenConsole.exe` 随包）、`desktop-terminal-view`、xterm | P1 | 13-desktop.md | ✅ |
| F15 | 全局搜索（跨会话/文件，独立窗口） | `global-search` 扩展（extension.json：「独立操作系统窗口，跨任务/空间/项目/产物检索并跳转定位」） | P1 | 13-desktop.md | ✅ |
| F16 | 托盘 / Deeplink | `dock-recent-apps-repair.js`、`deeplink-landing`、`parse-buddy-preview-deeplink` chunks、`default-open-handler.win32.js` | P1 | 13-desktop.md | ✅ |
| F17 | 消息渲染管线（MD/代码高亮/公式/图表） | renderer chunks：`vendor-markdown`、`vendor-highlight`、`vendor-katex`、`vendor-mermaid`、`markdown-editor` | P1(基础)/P2(mermaid) | 15-ui.md | ✅ |
| F18 | 设置中心 / 自检 / 日志 | `ModelsSettingsPanel/DataManagementPanel/SystemPermissionsPanel`、`main/self-check.js`、`workbuddy-server-logger.js`、`log-acl-guard.js` | P1 | 15-ui.md / 14-data.md | ✅ |
| F19 | Mermaid 图表渲染 | `renderer/assets/vendor-mermaid-*`（2.8MB）+ `mermaid-plugin-component-*`（按需初始化） | P2 | 20-mermaid-preview.md | P2 |
| F20 | Office 文档预览（docx/pdf/pptx/sheet） | `{docx,pdf,pptx,sheet}-preview-component-*` 统一 props；lib 签名 docx-preview/pdfjs/XLSX+Univer/pptx | P2 | 20-mermaid-preview.md | P2 |
| F21 | 自动更新（清单 + 过渡窗） | `resources/scripts/update-progress.ps1`（4 条关闭策略）+ `launch-update-progress.vbs`（无黑框机制） | P2 | 21-updater.md | P2 |
| F22 | Browser-use（中立动作协议） | `@genie/workbuddy-browser-use`："Provider-neutral Browser protocol, input, DOM CUA, visual primitives" | P2 | 22-browser-use.md | P2 |
| F23 | IM 通道 | `main/telegram.js` 插件六件套契约 + 长轮询/重连/4000 分块；`recordMsgId` 500 环形去重；im-channels extension fork 服务 | P3 | 23-im-channels.md | P2/3 |
| F24 | 系统分享目标（sparse MSIX） | `share-target/scripts/register.ps1`（AppXSvc 超时 Job/退出码 0-4/双写日志）+ `WorkBuddyShareTarget.msix` | P3 | 24-share-target.md | P3 |
| F25 | 云端技能市场 | `.codebuddy-plugin/marketplace.json` 索引结构 + `marketplace-skill-installer` SKILL.md（search/install、installed/already/refused） | P3 | 25-cloud-market.md | P3 |
| F26 | 端云同步（Edge Sync 替代） | `extensions/edge-sync/extension.json`（Conversation 事件推送 + 指令下发，fork 服务） | P4 | 26-sync-sandbox-a2a.md | P4 |
| F27 | 云沙箱（e2b 兼容） | `main/e2b-filesystem.js`（fs 接口 + 401 重连最小 10s） | P4 | 26-sync-sandbox-a2a.md | P4 |
| F28 | 多 Agent 协作（A2A） | `@a2a-js/sdk` 依赖 + experts/teams | P4 | 26-sync-sandbox-a2a.md | P4 |
| F29 | 设计令牌体系（亮/暗两套，暗灰阶=wb 调色板精确值；主题持久化+app:theme 广播） | `renderer/assets/tokens-Df-i-zsO.css`（亮 1980/暗 932 变量）+ `main/window-apps.js` | P5 | 27-pixel-ui.md | ✅ |
| F30 | 主窗像素复刻（壳层 38/220/22 + 任务头 48 + wb home 零会话态） | `renderer/index.html` 骨架（作者注释「布局参照真实 UI」） | P5 | 27-pixel-ui.md | ✅ 93.86% |
| F31 | 设置窗像素复刻（900×680 + chrome/×/nav200 + gray-2 底） | `main/window-apps.js` settings 窗 + `settings-window-perf` CSS | P5 | 27-pixel-ui.md | ✅ 27.37%（骨架口径） |
| F32 | 搜索窗像素复刻（800×640 + 输入带 + 空态 spinner） | bootstrap `sk-global-search-*` + `window-apps.js` | P5 | 27-pixel-ui.md | ✅ 94.08% |
| F33 | 预览窗像素复刻（980×720 + 32px 栏 + #f2f2f2 底） | bootstrap `sk-image-viewer-*` + `window-apps.js` image-viewer | P5 | 27-pixel-ui.md | ✅ 94.42% |
| F34 | MCP 服务面（会话/技能/搜索暴露为 MCP server） | `main/app-server-mcp-apps-host*.js`（mcpApps/mcpManager/mcpAppsDiag） | P6 | 30-mcp.md | ✅ T30 |
| F35 | 原生菜单最小面（应用菜单 + 会话快捷键，menu-builder 语义） | `main/menu-builder.js`、`menu-i18n.js` | P6 | 31-menu.md | ✅ T31 |
| F36 | 启动画面 splash（即显窗→主窗就绪交接） | `main/splash` + bootstrap 启动标记 | P6 | 32-splash.md | ✅ T32 |
| F38 | v5.8.2 真实 UI 对齐（窗带 30/侧栏 360/顶栏 64/hero/composer 卡/设置白卡/搜索 Tab，实机 CDP 基线） | 实机 V5.8.2 CDP 实测（wb-live-tokens-*.json、wb-live-*.png） | P7 | 33-v582-real-ui.md | ✅ 61.49/57.26/93.35 |
| F37 | 会话独立窗（P2 观察：个人并行会话需求出现再实施） | window-apps `conversation` + bootstrap `?windowKind=conversation` | P7 | — | 观察 |
| — | 更新器（NSIS 静默 + 过渡窗）→ 已由 F21 以清单驱动形态复刻 | `@genieworkbuddy-desktop-updater/installer.exe` | — | 21-updater.md | ✅→F21 |
| — | Office/文档预览 → 已由 F20 以开源组件复刻 | `docx-preview/pdf-preview/pptx-preview/sheet-preview` chunks | — | 20-mermaid-preview.md | ✅→F20 |
| — | mermaid 渲染 → 已由 F19 复刻 | `vendor-mermaid`、`mermaid-plugin-component` | — | 20-mermaid-preview.md | ✅→F19 |
| — | Browser-use → 已由 F22 复刻 | `@genie/workbuddy-browser-use`、`browser` chunk | — | 22-browser-use.md | ✅→F22 |
| — | IM 通道接入 → 已由 F23 复刻（协议公开平台；真 token 手工项） | `main/{feishu,slack,discord,telegram,dingtalk,qq,wecom-*,wechat*}.js` + 各官方 SDK | — | 23-im-channels.md | ✅→F23 |
| — | 系统分享目标（MSIX）→ 已由 F24 复刻 | `share-target/scripts/register.ps1`、`WorkBuddyShareTarget.msix` | — | 24-share-target.md | ✅→F24 |
| — | 云端技能市场 → 已由 F25 复刻 | `marketplace.json` 远端结构、`marketplace-skill-installer` | — | 25-cloud-market.md | ✅→F25 |
| — | 云同步 / Edge Sync → 已由 F26 复刻 | `extensions/edge-sync`（事件上云 + 指令下发） | — | 26-sync-sandbox-a2a.md | ✅→F26 |
| — | 云沙箱 → 已由 F27 复刻（e2b 兼容适配器） | e2b 依赖 + `e2b-filesystem.js` | — | 26-sync-sandbox-a2a.md | ✅→F27 |
| — | 多 agent 协作 → 已由 F28 复刻（A2A 最小面） | `@a2a-js/sdk`、`disable-agent-teams` chunk、experts/teams | — | 26-sync-sandbox-a2a.md | ✅→F28 |
| — | 支付/订阅 | `plugins/weixinpay`、`subscription-gate` | **排除** | — | — |

## 三、里程碑

```
M1 骨架可用    F01 F02 F03 F04            → 能开窗、能对话（接 OpenAI 兼容 API）
M2 敢让它动手  F05 F06 F07 F08 F09 F10    → 工具循环 + 模式策略 + 沙箱 + 确认
M3 个性化      F11 F12 F13                → 技能热装载 + 本地市场 + 记忆
M4 桌面完整度  F14 F15 F16 F17 F18        → 终端/搜索/托盘/渲染/设置/自检
M5 验收        99-test-plan 全绿 + 验收报告
M6 P2 渲染/壳  F19 F20 F21 F22            → mermaid/文档预览/更新器/浏览器工具
M7 P3/P4 生态  F23 F24 F25 F26 F27 F28    → IM/分享目标/云市场/同步/云沙箱/A2A
```

## 四、目录约定

```
myagent/
  design/          本设计文档目录
  app/             Electron 应用（main/ daemon/ engine/ renderer/ preload/）
  skills/          默认技能目录（SKILL.md 格式）
  tests/           unit / integration / e2e
  scripts/         构建（esbuild）、冒烟、验收 runner
  artifacts/       验收报告与测试产物
  runtime-data/    运行期用户数据（会话库、设置、日志；gitignore）
```

## 五、风险与降级路径（详见 01-architecture.md §6）

- `better-sqlite3`（原生，Electron ABI）：已实施双 ABI 方案（2026-10-14）——node_modules 保持 Node ABI 供测试层用，`scripts/setup-electron-sqlite.mjs` 把官方 Electron v136 预编译 vendor 到 `vendor/better-sqlite3-electron/`（npmmirror 镜像优先），daemon 在 Electron 下优先加载之；Electron 运行时 store.mode 已为 sqlite。vendor 缺失时仍降级 JSON（接口不变），另含 store.json→sqlite 一次性迁移。
- `node-pty`：优先 `@lydell/node-pty` 预编译产物；失败降级 `child_process` 管道终端（无 ANSI 全支持，F14 标注 degraded）。
- Electron 下载慢/失败：允许 `ELECTRON_MIRROR` 环境变量。
- 大模型：默认对接任意 OpenAI 兼容端点（个人自备 key/baseURL），测试用本地 mock server，不依赖外网。
