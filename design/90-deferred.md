# 90 · 延后与排除功能（Phase 2-4 / 排除项）

> 本文档记录本轮不实施的功能点、WorkBuddy 的实现证据、以及未来的复现路线。
> 排除项不属于"未完成"，是范围裁决（见 00-roadmap §一）。

## Phase 2（下个迭代候选）

| 功能 | WorkBuddy 证据 | 复现路线 |
|---|---|---|
| mermaid 图表渲染 | `vendor-mermaid`、`mermaid-plugin-component` | npm mermaid + 沙箱渲染容器 |
| Office 文档预览（docx/pdf/pptx/sheet） | `docx-preview/pdf-preview/pptx-preview/sheet-preview` 组件族；docx-preview 是开源库 | 直接用 docx-preview/pdfjs/sheetjs 开源组件 |
| 自动更新 | 独立 updater `@genieworkbuddy-desktop-updater`（installer.exe 435MB 缓存）、`update-progress.ps1` 注释详述 NSIS 静默升级 + VBS 中转 WinForms 过渡窗 + 新主窗口可见才关闭 | electron-updater + 简化过渡窗；个人用可延后 |
| Browser-use | `@genie/workbuddy-browser-use`、`browser` chunk | playwright + CDP 接入引擎工具 |

## Phase 3

| 功能 | WorkBuddy 证据 | 复现路线 |
|---|---|---|
| IM 通道 | 每平台一个主进程模块：`feishu.js`(lark SDK)、`slack.js`(socket-mode)、`discord.js`、`telegram.js`、`dingtalk.js`(stream)、`qq.js`(qqbot-connector)、`wecom-new.js`(aibot SDK)；消息去重 500 条环形队列（`recordMsgId`） | 按平台官方 bot API 逐个接入；沿用 500 队列去重设计 |
| 系统分享目标 | sparse MSIX `WorkBuddyShareTarget.msix` + `register.ps1`（注释含 AppLocker 规避与 P3 自愈说明） | 同 sparse package 方案，Add-AppxPackage 注册 Share Target |
| 云端技能市场 | `marketplace.json` 远端结构、`marketplace-skill-installer` | git 仓库/HTTP 索引 + 签名校验 |

## Phase 4

| 功能 | WorkBuddy 证据 | 复现路线 |
|---|---|---|
| Edge Sync（端云同步） | `extensions/edge-sync`：「本地 Conversation 事件推到云端 + 云端指令下发」，server bundle 4.4MB，用 Agent Client Protocol 内容格式 | 自建轻量同步服务或 WebDAV |
| 云沙箱 | e2b 依赖 + `e2b-filesystem.js` | e2b 个人账号接入 |
| 多 agent 协作 | `@a2a-js/sdk`、`disable-agent-teams` chunk、experts/teams | A2A 协议接入 |

## 排除项（不做）

| 功能 | 理由 |
|---|---|
| 支付/订阅（weixinpay、wechatpay-cli.exe、QmProtectorLib、subscription-gate、credits 面板） | 用户明确排除；且闭源国密/风控库 |
| TuringShield 风控、qimei 设备指纹、aegis/galileo 遥测上报 | 专有风控；个人工具无上报需求（有意省略全部外发遥测） |
| 腾讯文档 editor_sdk、drive-sdk、COS | 闭源 SDK + 账号体系；文档预览用开源库替代（Phase 2） |
| 微信桌面端 SDK 集成（share to chat、聊天记录导入） | 微信开放平台 PC SDK 需企业资质；个人不可得 |
| 网络 DNS/TCP 双引擎拦截 | 内核/hook 级实现越权且非个人必需；文件沙箱 + 命令确认已覆盖主要风险 |
| Job Object 进程树绑定 | 用 taskkill /T 兜底简化（效果近似） |
