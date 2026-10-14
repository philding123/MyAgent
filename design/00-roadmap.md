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
| — | 更新器（NSIS 静默 + 过渡窗） | `@genieworkbuddy-desktop-updater/installer.exe`、`resources/scripts/update-progress.ps1` | P2 | 90-deferred.md | 延后 |
| — | Office/文档预览（docx/pdf/pptx/sheet） | `docx-preview/pdf-preview/pptx-preview/sheet-preview` chunks、腾讯文档插件族 | P2 | 90-deferred.md | 延后 |
| — | IM 通道接入 | `main/{feishu,slack,discord,telegram,dingtalk,qq,wecom-*,wechat*}.js` + 各官方 SDK | P3 | 90-deferred.md | 延后 |
| — | 系统分享目标（MSIX） | `share-target/scripts/register.ps1`、`WorkBuddyShareTarget.msix` | P3 | 90-deferred.md | 延后 |
| — | 云同步 / Edge Sync | `extensions/edge-sync`（事件上云 + 指令下发） | P4 | 90-deferred.md | 延后 |
| — | 支付/订阅 | `plugins/weixinpay`、`subscription-gate` | **排除** | — | — |

## 三、里程碑

```
M1 骨架可用    F01 F02 F03 F04            → 能开窗、能对话（接 OpenAI 兼容 API）
M2 敢让它动手  F05 F06 F07 F08 F09 F10    → 工具循环 + 模式策略 + 沙箱 + 确认
M3 个性化      F11 F12 F13                → 技能热装载 + 本地市场 + 记忆
M4 桌面完整度  F14 F15 F16 F17 F18        → 终端/搜索/托盘/渲染/设置/自检
M5 验收        99-test-plan 全绿 + 验收报告
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

- `better-sqlite3`（原生，Electron ABI）：优先用官方 Electron prebuild；失败降级 JSON 存储适配器（接口不变）。
- `node-pty`：优先 `@lydell/node-pty` 预编译产物；失败降级 `child_process` 管道终端（无 ANSI 全支持，F14 标注 degraded）。
- Electron 下载慢/失败：允许 `ELECTRON_MIRROR` 环境变量。
- 大模型：默认对接任意 OpenAI 兼容端点（个人自备 key/baseURL），测试用本地 mock server，不依赖外网。
