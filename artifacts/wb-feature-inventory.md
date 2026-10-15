# WorkBuddy v5.7.7 全量功能清单 × MyAgent 复刻对照（含偏差修复计划）

- 生成：2026-10-15。方法论：feature-replication-workflow（证据 → 有出处的解释 → 对照 → 计划）。
- 证据基线：`D:\tools\workbuddy\install\resources\app.asar`（SHA-256
  `035254bc76310ea46317433e4840602094543ef323d2d5c5aff7c131729de918`）全量解包于
  `%TEMP%\wb-extract\app\`；下方「出处」均相对该目录。
- 对照方：MyAgent（本仓库）。验收口径：`npm run verify` ALL GREEN（T01–T29）+
  像素证据（`artifacts/pixel-comparison.md`、`artifacts/pixel-evidence/`）。
- 目录来源（四类交叉）：
  ① 窗口注册表 `main/window-apps.js`（rendererEntry 共 11 个：
  `buddy-app/conversation/settings/global-search/image-viewer/developer-profile/
  office/demo/im-merge-detail/im-reaction-users/main`）；
  ② 主进程模块群 `main/*.js`（约 140 个，名称即功能面）；
  ③ 渲染层 chunks 与 i18n（`renderer/assets/`，1164 个 JS；
  ④ 设计文档 00-roadmap / 90-deferred / 13~27（此前逆向结论，含
  roadmap 表内逐条证据路径）。

## §1 WorkBuddy 全量功能清单（按域，每项带出处）

### A. 桌面壳与窗口系统
| 功能 | 出处 |
|---|---|
| 主窗（buddy-app）与会话工作台 | `main/window-apps.js`（buddy-app）、`module.desktop-host.js` |
| 会话独立窗（conversation 可脱主窗） | window-apps `conversation` + bootstrap `?windowKind=conversation` |
| 设置独立窗（900×680） | window-apps `settings` + bootstrap `sk-settings-loading` |
| 全局搜索独立窗（800×640） | window-apps `global-search` + `extensions/global-search/extension.json` |
| 图片预览独立窗（utility） | window-apps `image-viewer` + bootstrap `sk-image-viewer-loading` |
| 开发者主页独立窗（640×760） | window-apps `developer-profile` + bootstrap `sk-dev-*` |
| Office 冷启动窗（含吉祥物加载页） | window-apps `office` + bootstrap `sk-office-cold-start`、`main/office-window-host.js` |
| IM 合并详情窗 / IM 表情回应人列表 | window-apps `im-merge-detail`、`im-reaction-users` |
| demo 窗口（内部演示用） | window-apps `demo` |
| 任务栏最近项修复 / 标题栏覆盖层 / 原生菜单 | `main/dock-recent-apps-repair.js`、`title-bar-overlay`、`menu-builder.js`、`menu-i18n.js` |
| 启动画面（splash）与启动性能标记 | `main/splash`、`startup-mark-log-mirror.js`、`startup_mark`（bootstrap 计时） |
| 远程窗口代理传输 | `main/remote-window-broker-transport*.js` |
| 浏览器预览窗（Buddy 内嵌浏览） | `main/browser-preview.js` |
| 窗口表现系统（preset/utility/modal） | `main/window-presentation*.js` |

### B. 会话与 Agent 引擎
| 功能 | 出处 |
|---|---|
| 常驻守护进程 + RPC 总线（wb:invoke） | `main/daemon-bootstrap.js`、`bootstrap-daemon-in-main-process.js` |
| Agent CLI 引擎（headless，JSON 流） | `cli/`（codebuddy、`dist/codebuddy-headless.js`） |
| 进程预热池 | `main/cli-prewarm-pool.js`、`cli-process-env.js` |
| 会话库（SQLite WAL + 恢复 + 迁移） | `main/app-server-database*.js`、`wal-checkpoint-worker.js`、`localstorage-migration.js` |
| 归档产物清扫 / 剪贴板压缩包读取 / tar·zip 解析 | `archive-artifact-sweep.js`、`clipboard-zip-reader.js`、`tar`、`zip-parser` |
| 启动/性能追踪 | `marks/`、`perf-metrics`、`perf-menu-state-sync`、`startup-mark-log-mirror` |
| prompt 追踪报告 | `prompt-trace-reporter.js` |
| 守护进程应用服务端（app-server） | `module.app-server.js`、`daemon-app-server-main.js`、`app-server-background-services.js` |
| MCP 应用宿主（app-server 内托管 MCP apps） | `main/app-server-mcp-apps-host*.js`（mcpApps/mcpManager/mcpAppsDiag） |
| sidecar 进程管理 | `main/sidecar-manager.js`、`sidecar-entry.js` |
| determinism/ID/JSON-schema 基础设施 | `deterministic-id-generator.js`、`json-schema-traverse`、zod schema 模块（`acp.js` 等，待深挖） |

### C. 工具与执行安全
| 功能 | 出处 |
|---|---|
| 文件/命令沙箱规则（tsbx_rules） | `cli/vendor/sandbox/5.7.10/tsbx_rules.json` |
| 凭证保护与落盘加密 | `main/credential-protection-bootstrap.js`、`file-authentication-storage.js` |
| web 偏好加固 | `main/secure-web-preferences.js` |
| 危险命令确认面板 | renderer `SecurityCenterPanel/SystemPermissionsPanel` chunks |
| 网络拦截（DNS/TCP 双引擎） | `main/network`（**排除**：内核/hook 级） |
| 威胁数据库 | `main/threat-database-galileo.js`（**排除**：galileo 遥测族） |

### D. 技能与插件生态
| 功能 | 出处 |
|---|---|
| 内置插件容器（skills/interactionmode/weixinpay…） | `plugins/workbuddy-builtin/*` |
| SKILL.md 技能 + 热装载 | `plugins/workbuddy-builtin/skills/*/SKILL.md` |
| 交互模式（ask/plan/craft prompt 装配） | `plugins/workbuddy-builtin/interactionmode/*` |
| 本地/云端技能市场（search/install/installed/already/refused） | `.codebuddy-plugin/marketplace.json`、`marketplace-skill-installer` |
| 技能面板/选择器 | renderer `skills-panel/skill-picker` chunks |

### E. 个性化与账号
| 功能 | 出处 |
|---|---|
| 记忆与个人化面板 | renderer `MemorySettingsPanel/PersonalizationPanel` |
| 账号体系（登录/资料/积分） | `main/account.js`、renderer `AccountPanel`、`AccountCreditsSection`（**排除**积分） |
| 鉴权协调/会话迁移/过期观察 | `workbuddy-auth-product-coordinator.js`、`legacy-auth-session-migrator.js`、`auth-loss-observation.js`、`legacy-localstorage-fastpath-marker.js` |
| 订阅面板/邀请返利 | renderer `SubscriptionUsagePanel`、i18n `conversation.inviteFriends.*`（**排除**） |

### F. IM 通道群（15+ 模块）
| 功能 | 出处 |
|---|---|
| 协议公开平台（telegram/feishu/slack/discord/dingtalk） | `main/{telegram,feishu,slack,discord,dingtalk}.js` |
| 闭源/企业平台（企微 IOA/新版企微/微信家族/QQ/元宝/微信客服/公众号/AI bot） | `main/{wecom-ioa,wecom-new,wecom-skill-policy,wechat-chat-history,wechatkf,wechatmp,qq,weixin,yuanbao,wecomaibot,wecomaibot-client}.js`、`ioa-im-actions.js`、`ioa-im-override.js`（多数 **排除**：协议不公开/需资质） |
| IM 通道扩展框架 | `extensions/`（im-channels fork 服务，见 roadmap F23 证据） |

### G. 文档与办公
| 功能 | 出处 |
|---|---|
| 腾讯文档集成（editor_sdk/drive-sdk） | `main/tencent-docs-*`、`tencent-docs/`（**排除**，F20 开源替代） |
| Office 窗口族（打开/关联修复/原生主题/协议） | `main/office-window-{host,native-theme,protocols}.js`、`office-file-association-repair.js` |
| 文档预览组件族（docx/pdf/pptx/sheet） | renderer `{docx,pdf,pptx,sheet}-preview-component-*` chunks |
| TDOC 开发环境 cookie | `main/tdoc-dev-env-cookies.js` |

### H. 云与同步
| 功能 | 出处 |
|---|---|
| Edge Sync（会话事件上云 + 指令下发） | `extensions/edge-sync/extension.json` |
| e2b 云沙箱 | `main/e2b-filesystem.js` |
| COS 对象存储 / 网盘路由 | `main/cos-nodejs-sdk-v5`、`netdrive-env-route.js`（**排除**：账号体系） |

### I. 桌面集成与系统
| 功能 | 出处 |
|---|---|
| 托盘 / Deeplink / 分享目标 MSIX | roadmap F16/F24 证据（dock-recent-apps-repair、deeplink chunks、`share-target/`） |
| 自动更新（NSIS 静默 + 过渡窗 + 平台分支） | `main/software-update.js`、`update-service.{darwin,linux,win32}`、`resources/scripts/update-progress.ps1` |
| 崩溃报告 | `main/crash-reporter.js` |
| 自检 | `main/self-check.js` |
| 环境/产品配置 | `main/env-product-provider.js`、`workbuddy-product-config.js`、`workbuddy-paths.js`、`dev-env-*.js`、`install-dir-guard-i18n.js` |

### J. 浏览器与自动化
| 功能 | 出处 |
|---|---|
| Browser-use（中立动作协议） | `@genie/workbuddy-browser-use`（roadmap F22 证据） |
| CDP 性能剖析器 | `main/cdp-profiler.js` |
| eval 注入服务 | `main/eval-inject-server.js` |

### K. 观测/遥测/内部设施
| 功能 | 出处 |
|---|---|
| 遥测上报（aegis/galileo/qimei/Turing） | `main/{qimei-helper,turing-sdk,threat-database-galileo,automation-failure-galileo}.js`（**排除**：有意无外发遥测） |
| 服务端日志 + ACL | `main/workbuddy-server-logger.js`、`log-acl-guard.js`、`persistent-log-writer.js`、`package-log-worker.js` |
| hub 追踪交接 / 性能剖析 handlers | `hub-tracer-handoff.js`、`perf-profiler-handlers.js` |
| 杂项基础设施（bridge/contract/handlers/host/http/hub/io/legacy/origins/protocol/runtime-*/safer/transport*…） | `main/` 对应文件（rolldown 打包基础设施，非独立功能面） |

### L. 商业化/支付
| 功能 | 出处 |
|---|---|
| 微信支付 / 订阅门 / 积分 / 邀请 / 加购 | `plugins/weixinpay`、`subscription-gate`、`wechatpay-cli.exe`、renderer `SubscriptionUsagePanel/AccountCreditsSection/addon-purchase`（**全部排除**，design/27 七面清单） |

### M. 待深挖 → 已定性（2026-10-15，D9 关闭）
`acp.js` = zod schema 构造器族（rolldown 打包基础设施，非 Agent Client Protocol）；
`celljs-deps.js` = 表格（sheet）服务端依赖装配（引用 code-cache/server/tar，归 G 域文档办公）；
`claw-content-utils.js` = 内容工具函数（wb agent 内部名，基础设施）；
`poi-user-asset-service.js` = 腾讯 POI 用户资产服务（账号体系，**排除**）；
其余（contract/handlers/hub/ioa/md5-worker/multipart-parser/source/esm*）为打包基础设施或已归前述域。

## §2 MyAgent 复刻对照（F01–F33，全部有证据）

| ID | 功能 | 状态 | 证据 |
|---|---|---|---|
| F01 | 多窗口框架（主/设置/搜索/预览 + 单实例 + 托盘恢复） | ✅ | T01 e2e:main-window/multi-window；`app/main/windows.js` |
| F02 | 守护进程 + RPC 总线（codec/重启拉起/快照） | ✅ | T02a/T02b；`app/daemon/index.js` methods 表 |
| F03 | 会话持久化（sqlite/json 双实现 + 恢复 + 迁移） | ✅ | T03 四组 + 降级记录「store 模式: sqlite」；`app/daemon/store.js` |
| F04 | Agent 引擎（子进程 JSON 流） | ✅ | T04a/T04b；`app/engine/index.js` |
| F05 | 预热池 | ✅ | T05 四组；`app/engine/pool.js` |
| F06 | 内置工具集（7 工具，OpenAI function 形状） | ✅ | T06 八组；`app/engine/tools.js` |
| F07 | 模式策略（ask/plan/craft 双保险） | ✅ | T07 三组；`app/engine/policy.js` |
| F08 | 沙箱规则（凭证硬拒/fail-safe/glob） | ✅ | T08 七组；`app/daemon/sandbox.js` |
| F09 | 命令确认门控（120s 超时默认拒） | ✅ | T09a/b/c；`app/engine/index.js` confirm 流 |
| F10 | 凭证加密（safeStorage/AES-GCM+0600） | ✅ | T10 两次断言「无明文落盘」；`app/daemon/vault.js` |
| F11 | 技能系统（SKILL.md + 热装载 + system 注入） | ✅ | T11 六组 + T11b；`app/daemon/skills.js` |
| F12 | 本地市场（目录/zip 安装） | ✅ | T12a/T12b；`app/daemon/market.js` |
| F13 | 记忆注入 LLM | ✅ | T13 两组；`app/daemon/memory.js` |
| F14 | 终端（node-pty + xterm，降级管道） | ✅ | T14 + e2e:terminal（degraded 标注机制）；`app/daemon/terminal.js` |
| F15 | 全局搜索（独立窗 800×640） | ✅ | T15 + e2e:ui-search；`app/daemon/search.js` |
| F16 | 托盘 / Deeplink | ✅ | e2e:tray/deeplink-consumed；`app/main/tray.js` |
| F17 | 渲染管线（sanitize 攻防断言） | ✅ | e2e:render-sanitize（pwned:false）；`app/renderer/src/app.js` |
| F18 | 设置中心 / 自检 / 日志 | ✅ | T18a + e2e:selfcheck/preload-bridge；`app/daemon/index.js` |
| F19 | Mermaid 渲染 | ✅ | e2e:mermaid-render（svg:true errors:0） |
| F20 | 文档预览（docx/pdf/xlsx/pptx/txt/img） | ✅ | T20a + e2e:preview-*；`app/renderer/src/preview.js` |
| F21 | 自动更新（清单+sha256+过渡事件） | ✅ | T21a/b 九组 + e2e:updater-status；`app/main/updater.js` |
| F22 | Browser-use（playwright-core + 系统浏览器） | ✅ | T22a/b + e2e:browser-tool；`app/engine/tools.js` browser |
| F23 | IM 通道（telegram 完整环 + 5 通道骨架 + webhook） | ✅ | T23a/b/c 十组 + e2e:im-status；`app/daemon/im.js` |
| F24 | 分享目标 MSIX（sparse + register.ps1） | ✅ | T24a 三组 + e2e:share-argv；`share-target/` |
| F25 | 云端市场（HTTP 索引 + sha256 + 关键词） | ✅ | T25a/T25 + e2e:market-status；`app/daemon/market.js` |
| F26 | 端云同步（目录目标 + rev 冲突保留双侧） | ✅ | T26a/T26 + e2e:sync-status；`app/daemon/sync.js` |
| F27 | 云沙箱（e2b 兼容 + 401 单次重连 + 工具路由） | ✅ | T27 五组 + e2e:phase4-fields；`app/daemon/cloud-sandbox.js` |
| F28 | A2A 协作（agentCard + message/send + delegate） | ✅ | T28 四组 + e2e:a2a-card；`app/daemon/a2a.js` |
| F29 | 设计令牌（亮/暗两套，暗灰阶=wb 精确值） | ✅ | e2e:ui-token + **ui-token-dark**；`app/renderer/style.css` |
| F30 | 主窗像素（壳层 38/220/22 + 任务头 48 + wb home） | ✅ | e2e:ui-shell/ui-main + 像素 **93.86%**；diff-main.png |
| F31 | 设置窗像素（900×680 + chrome/×/nav200） | ✅ | e2e:ui-settings + 像素 27.37%（骨架口径，见偏差 D1）；diff-settings.png |
| F32 | 搜索窗像素（800×640 + 输入带 + spinner） | ✅ | e2e:ui-search + 像素 94.08%；diff-search.png |
| F33 | 预览窗像素（980×720 + 32px 栏 + #f2f2f2） | ✅ | e2e:ui-preview + 像素 **94.42%**；diff-preview.png |
| F34 | MCP 服务面（stdio server：sessions/search/skills 工具 + 会话资源） | ✅ | T30 八测 + e2e:mcp-status；`app/daemon/mcp.js`、`mcp-server-child.js` |
| F35 | 原生菜单最小面（编辑/窗口/帮助/关于 + 快捷键闭环，v5.8.2 band 顺序） | ✅ | e2e:menu（Ctrl+N 点击 → 会话 +1）；`app/main/menu.js` |
| F36 | 启动画面 splash（800×500 frameless → 主窗交接） | ✅ | e2e:splash-handoff；`app/main/splash.js` |
| F38 | v5.8.2 真实 UI 对齐（窗带 30/侧栏 360/顶栏 64/hero/composer 卡/设置白卡/搜索 Tab；实机 CDP 基线） | ✅ | 实机对比 main(home) 61.49% / settings 57.26% / search 93.35%；design/33 + wb-live-* 证据 |
| F39 | 空间（space 字段 + 任务/空间分组） | ✅ | T33；`sessions.setSpace`、app.js 分组 |
| F40 | 定时任务（持久化调度器 + 设置面板） | ✅ | T34；`app/daemon/tasks.js`、tasks 面板 |
| F41 | 预设/助理（persona 通道 + 面板） | ✅ | T35；`app/daemon/presets.js`、presets 面板 |
| F42 | 资料库（library 目录 + 引擎工具 + 面板） | ✅ | T36；library_list/library_read、library 面板 |
| F43 | @ 上下文 / 技能调用 | ✅ | T37 augmentContext；composer @// 按钮 |
| F44 | 产物卡片（write_file → 卡片网格，点击预览） | ✅ | 渲染层 artifact-grid；app.js appendArtifact |
| — | 支付排除（7 面） | ✅（排除项按清单不存在） | e2e:ui-paywall-zero 四窗 0 命中 |

暗色补充：search-dark **99.88%**、settings-dark 27.37%（同口径）、main-dark/
preview-dark 为真实链路渲染证据（wb 无暗骨架）；dark 断言 ui-token-dark
（brand #4ecba0 / content #1a1a1a / side #1f1f1f / gray2 #292929）。

## §3 明确排除/延后（裁决记录）

见 design/90-deferred.md 全表：支付/订阅（L 域全部）、遥测风控（K 域 aegis/
galileo/qimei/Turing）、腾讯文档与 COS（G 域 sdk，F20 开源替代）、微信 PC SDK、
网络内核拦截、Job Object、闭源 IM 协议端（F 域 8 个模块）、e2b 真实账号；
另预览依赖审计遗留两项（xlsx GHSA×2、echarts XSS 经 pptx-preview）为已知缓解项。

## §4 偏差清单（复刻面与 wb 的已知出入）

| # | 偏差 | 影响 | 现状证据 |
|---|---|---|---|
| D1 | ~~设置窗对比口径为「加载骨架」~~ **已解决（2026-10-15）**：实机 V5.8.2 CDP 直连成功，settings 真实 UI 已采集并对齐（57.26% 实机口径）；v5.7.7 骨架口径数字保留作历史 | 已消除 | wb-live-settings.png、design/33 |
| D2 | 会话独立窗（wb `conversation` 窗）未复刻：MyAgent 会话固定在主窗内 | 多会话并行查看不可用 | window-apps.js `conversation` vs `windows.js`（无独立会话窗） |
| D3 | wb 独有窗口未复刻：developer-profile / office / im-merge-detail / im-reaction-users / demo | 对应 wb 业务（开发者主页、腾讯文档 office、IM 合并）不在 roadmap 范围 | §1 A 域 |
| D4 | ~~MCP 面缺失~~ **已修复**：F34 MCP 服务面（T30，stdio server + 四工具 + 会话资源） | 已消除 | `app/daemon/mcp.js` |
| D5 | ~~原生菜单缺失~~ **已修复**：F35 最小菜单面（T31，Ctrl+N 闭环） | 已消除 | `app/main/menu.js` |
| D6 | ~~无启动画面~~ **已修复**：F36 splash（T32，800×500 frameless 交接） | 已消除 | `app/main/splash.js` |
| D7 | IM 覆盖面：MyAgent 6 通道 vs wb 15+ 模块（其中 8 个闭源协议已排除，公开协议平台对齐） | 长尾平台不可用（多数已裁决排除） | §1 F 域 |
| D8 | 预览依赖审计遗留（xlsx GHSA×2 无上游修复、echarts XSS 经 pptx-preview） | 仅本地自选文件输入，风险受沙箱门控缓解 | 90-deferred §排除项末行 |
| D9 | 待深挖模块（acp/celljs/claw/poi 等）未归类 | 清单完备性 | §1 M 域 |

## §5 修复偏差计划

P0（立即，均为验收正确性）：无——T01–T29 全绿，契约无破坏。

P1（下一轮候选，个人使用价值高且工程可行）：
1. **D4 → 立项 F34「MCP 服务面」**：把 MyAgent 的会话/技能/搜索暴露为 MCP server
   （对齐 wb app-server-mcp-apps-host 的托管语义；stdio + 最小 tools/resources）。
   验收：T34（MCP 客户端 discover + tools/call 回环）。
2. **D8 → 预览依赖缓解**：xlsx 换 SheetJS 官方源（npm `xlsx` 已是官方源，复核
   版本 ≥0.18.6 修复面）；pptx-preview 升 1.0.0（breaking，评估 echarts 剥离）。
   验收：`npm audit` 无高危直达渲染路径 + T20 回归。
3. **D5 → 立项 F35 原生菜单最小面**：应用菜单（文件/编辑/视图/帮助）+ 会话快捷键，
   menu-builder 语义对齐（i18n 走现有 zh 文案）。验收：手工清单 + 快捷键 e2e。
4. **D6 → 立项 F36 splash 窗**：wb 同款「即显窗→主窗就绪交接」（纯壳，无网络）。验收：
   冷启动截图对比 + e2e:splash 交接时序。
5. **D9 → 待深挖模块清单归档**：对 acp/celljs/claw/poi 逐个 30 分钟定性，更新本
   清单 M 域（纯文档任务）。

P2（延后/观察）：
6. **D2 → 立项 F37 会话独立窗（P2 观察）**：工程量大（会话视图组件化 + 多窗状态
   同步）；先观察个人使用是否真需要并行会话，需要时按 wb `conversation` 窗语义实施。
7. **D7 → IM 长尾**：仅当出现可复现的公开协议平台再立项；闭源协议端维持排除。
8. **D1 → 设置真实 UI 口径**：维持骨架口径与几何断言；若未来拿到可运行的 wb
   宿主（登录态+可写 profile），用 pixel-shoot 管线直接升级对比。

永久排除（不再计划）：支付/订阅、遥测风控、腾讯文档/COS SDK、微信 PC SDK、
内核网络拦截、闭源 IM 协议端、账号体系。

## §6 维护

本清单随功能轮更新：新增 wb 面发现 → §1 加行；MyAgent 立项 → §2 加 F 行；
裁决变化 → §3/§5 同步。证据文件变更（截图/diff/comparison.json）随 verify 重跑
自动刷新。
