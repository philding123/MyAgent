# AGENTS.md — design/（设计文档与逆向证据）

## 职责与定位

全部功能设计、WorkBuddy 逆向证据、验证方法的 SSOT。**改功能先改这里**；实现与文档冲突时以验收结论回填文档。

## 阅读顺序

1. [00-roadmap.md](00-roadmap.md) — 总路线图：F01–F18 功能点表（每项含证据路径/阶段/状态）、里程碑、目录约定。**入口文件**。
2. [01-architecture.md](01-architecture.md) — 进程模型/RPC 协议/数据模型/技术栈降级矩阵。
3. 功能域设计：[10-agent-core.md](10-agent-core.md)（引擎/工具/预热/模式）· [11-daemon-rpc.md](11-daemon-rpc.md) · [12-security.md](12-security.md)（沙箱/确认/凭证）· [13-plugins.md](13-plugins.md)（技能/市场/记忆）· [13-desktop.md](13-desktop.md)（窗口/终端/搜索/托盘/deeplink）· [14-data.md](14-data.md)（存储/自检/日志）· [15-ui.md](15-ui.md)（渲染/设置）。
4. [90-deferred.md](90-deferred.md) — Phase 2–4 与排除项（含支付排除裁决）。
5. [99-test-plan.md](99-test-plan.md) — T01–T18 测试矩阵与验收门槛。

## 铁律

1. 每条设计必须含「WorkBuddy 观察（证据路径）→ 复现设计 → 验证方法」三段；观察与推断分开写。
2. 有意偏离 WorkBuddy 的点必须显式标注偏离及理由（如：无遥测、网络双引擎不做）。
3. 功能点 ID（F01–F18）与测试 ID（T01–T18）是全局稳定标识，废弃需在 00-roadmap 记录。
4. Phase-1 已验收（2026-10-13）；新工作从 90-deferred 的 Phase 2-4 立项。

## 验证

文档正确性由 `npm run verify`（T 矩阵全绿）与 `artifacts/acceptance-report.md` 背书。
