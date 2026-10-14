# ADR 2026-10-13 · 范围裁决：排除支付系统，延后腾讯专有服务

- 状态：Accepted（2026-10-13）
- 关联：design/00-roadmap.md §一、design/90-deferred.md

## 背景

MyAgent 是 WorkBuddy 的个人使用复刻。WorkBuddy 含支付订阅（weixinpay/subscription-gate）、腾讯专有 SDK（ImSDK/TuringShield/qimei/腾讯文档 editor_sdk/drive-sdk）与 IM 通道矩阵。

## 决策

1. **支付/订阅明确排除**（用户要求）：不实现 weixinpay、credits、subscription-gate 等价物。
2. **腾讯闭源 SDK 不做**：无法获得授权；对应能力按开源替代路线延后（文档预览用 docx-preview/pdfjs，Phase-2）。
3. **IM 通道延后 Phase-3**：仅协议公开平台（飞书/钉钉/Slack/Discord/Telegram）可复现，需个人 token。
4. **有意偏离记录**：无任何遥测外发（WorkBuddy 有 aegis/galileo/qimei）；网络双引擎沙箱不做（文件沙箱+命令确认覆盖主要风险）。

## 后果

- 验收口径不含支付相关功能点；商业化为永不目标。
- 新增功能须先在 90-deferred 立项并确认不属于排除项。
