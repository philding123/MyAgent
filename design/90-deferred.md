# 90 · 延后与排除功能（历史决策 + 现状）

> 本文档原记录 Phase 2-4 候选与排除项。2026-10-14 起 Phase 2-4 候选已全部立项实现
> （F19–F28，见 00-roadmap 与 design/20–26），本文件保留排除项与历史候选去向。

## 已立项（原 Phase 2-4 候选 → 现功能点）

| 原候选 | 现功能点 | 设计文档 |
|---|---|---|
| mermaid 图表渲染 | F19 | 20-mermaid-preview.md |
| Office 文档预览（docx/pdf/pptx/sheet） | F20 | 20-mermaid-preview.md |
| 自动更新 | F21（清单驱动 + 过渡窗语义复刻） | 21-updater.md |
| Browser-use | F22（playwright-core + 系统浏览器） | 22-browser-use.md |
| IM 通道 | F23（插件契约照搬 telegram.js 证据） | 23-im-channels.md |
| 系统分享目标 | F24（sparse MSIX + 自签证书） | 24-share-target.md |
| 云端技能市场 | F25（HTTP 索引 + sha256） | 25-cloud-market.md |
| 云同步 / Edge Sync | F26（目录/WebDAV 目标） | 26-sync-sandbox-a2a.md |
| 云沙箱 | F27（e2b 兼容适配器，mock 验证） | 26-sync-sandbox-a2a.md |
| 多 agent 协作 | F28（A2A 最小面） | 26-sync-sandbox-a2a.md |

## 排除项（不做）

| 功能 | 理由 |
|---|---|
| 支付/订阅（weixinpay、wechatpay-cli.exe、QmProtectorLib、subscription-gate、credits 面板） | 用户明确排除；且闭源国密/风控库 |
| TuringShield 风控、qimei 设备指纹、aegis/galileo 遥测上报 | 专有风控；个人工具无上报需求（有意省略全部外发遥测） |
| 腾讯文档 editor_sdk、drive-sdk、COS | 闭源 SDK + 账号体系；文档预览已用开源库替代（F20） |
| 微信桌面端 SDK 集成（share to chat、聊天记录导入） | 微信开放平台 PC SDK 需企业资质；个人不可得 |
| 网络 DNS/TCP 双引擎拦截 | 内核/hook 级实现越权且非个人必需；文件沙箱 + 命令确认已覆盖主要风险 |
| Job Object 进程树绑定 | 用 taskkill /T 兜底简化（效果近似） |
| IM 平台中闭源协议端（微信/企微个人号/QQ 非官方协议/元宝/Teams） | 协议不公开或需企业资质；F23 覆盖协议公开平台 + 通用 webhook 兜底 |
| e2b 真实云账号绑定 | 需外部账号；F27 以 e2b 兼容适配器 + mock 实现并验证协议面，真实接入为手工项 |
| 预览依赖审计遗留（echarts XSS 经 pptx-preview 1.0.7 传递；uuid 已 ^10 安全） | xlsx 两条高危 GHSA **已解决**（2026-10-15：换 SheetJS CDN 源装 0.20.3，T20 回归 PASS，审计命中 0）。剩余 echarts 链：pptx-preview 1.0.0（去 echarts，breaking）+ 回归 T20，待依赖轮 |
