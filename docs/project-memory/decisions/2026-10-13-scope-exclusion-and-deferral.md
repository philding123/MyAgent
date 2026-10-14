# ADR 2026-10-13 · 范围裁决：排除支付系统，延后腾讯专有服务

- 状态：Accepted（2026-10-13）

## Decision

1. **支付/订阅明确排除**（用户要求）：不实现 weixinpay、credits、subscription-gate 等价物。
2. **腾讯闭源 SDK 不做**：无法获得授权；对应能力按开源替代路线延后（文档预览用 docx-preview/pdfjs，Phase-2）。
3. **IM 通道延后 Phase-3**：仅协议公开平台（飞书/钉钉/Slack/Discord/Telegram）可复现，需个人 token。
4. **有意偏离记录**：无任何遥测外发（WorkBuddy 有 aegis/galileo/qimei）；网络双引擎沙箱不做（文件沙箱+命令确认覆盖主要风险）。

## Context

MyAgent 是 WorkBuddy 的个人使用复刻。WorkBuddy 含支付订阅（weixinpay/subscription-gate）、腾讯专有 SDK（ImSDK/TuringShield/qimei/腾讯文档 editor_sdk/drive-sdk）与 IM 通道矩阵。

## Options Considered

- 全量复刻含支付（否决：用户明确排除，且闭源国密/风控库不可得）。
- 腾讯 SDK 申请接入（否决：企业资质门槛，个人不可行）。
- 排除支付 + 开源替代 + IM 延后（选定）。

## Rationale

范围裁决是验收口径的前提（验收不含支付功能点）；闭源依赖不可复现，开源替代可达成同等用户体验；IM 通道协议公开的平台才有可行性。

## Consequences

- 验收口径不含支付相关功能点；商业化为永不目标。
- 新增功能须先在 design/90-deferred.md 立项并确认不属于排除项。

## Verification

- design/00-roadmap.md 范围裁决表与 F01–F18 功能点表不含任何支付/订阅项。
- `npm run verify` 验收矩阵（99-test-plan.md）全部通过即证明在裁范围内完成。
