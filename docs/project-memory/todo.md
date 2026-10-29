# Project Memory TODO

## Now

- 手工抽查第 4 项：托盘点击交互（显示/恢复/退出）——留待日常使用验证，无代码工作。
- 下次日常启动验证：selfcheck 应显示 store.mode=sqlite，旧会话经 store.json 一次性迁移可见。

## Next

- 取得 wb「专家·技能·连接器」页实机截图（CDP），按 design/35 回改技能页布局并加像素断言
- F24 手工项（一次管理员会话）：开发者模式 + SDK makeappx/signtool 签名 + 证书入 TrustedPeople → Add-AppxPackage；激活 argv 契约观察后定稿转发器（可顺带逆 WorkBuddyShareTarget.exe，带 PDB）。
- F27 手工项：有 e2b 账号时云内跑一次命令；F26 两台机器目录同步互通。

## Later

- 产物另存副本 + 变更默认交付目录（F55 首轮 P2 后续，design/38 §6.2，按需再做）
- WorkBuddy 原生模块深挖（sandbox-center.exe / tsbx.dll / turing-sdk / WorkBuddyShareTarget.exe）：用已就绪的 WSL Ghidra 引擎（ADR 2026-10-14-wsl-ghidra-native-analysis-engine）。
- A2A 扩展面（streaming / task 生命周期）与 IM 骨架平台真实 WS 传输（需各平台 token）。

## Blocked

- None

## Recently Done

- Phase 5–14 追记（2026-10-15~10-28）：像素 UI/实机 v5.8.2 基线/行为对比/功能补齐/安装发布/技能市场/侧栏六项等 F29–F54 全部完成，详见 design/00-roadmap 与 artifacts/acceptance-report.md
- F55 产物中心 + F56 开源专家市场（含金融批）+ F57 社交内容拉取合入 main（merge fb5558d，T50/T51/T52 全绿）
- F37 会话独立窗口：wb 单例复用重定向口径，T53 全绿；连带修复 verify 门槛假 ALL GREEN（聚合 T 行，issue 2026-10-29），merge 4805946
- F58 文件历史/回滚：四阶段一轮落地（本地版本快照 + files.history.* + 产物面板恢复），T54 全绿，merge 3b902a1
- **Done (2026-10-14) 手工项第二轮：F21 完整 apply E2E 全过；F24 注册 schema 推进至签名/信任边界（剩余三步文档化）；真 SQLite in Electron 落地（双 ABI vendored + 迁移，降级消除，verify T01–T28 仍全绿）。_(retired 2026-10-14)_
- **Done (2026-10-14) Phase 2–4 全落地：F19–F28 十个功能点实现并逐项验证（T01–T28 全绿：49 单测 + 41 集成 + 21 冒烟步），支付仍排除；design/20–26 七份新设计文档，90-deferred 改记去向。_(retired 2026-10-14)_
- **Done (2026-10-14) git init + 首次提交；project-memory 脚本 flock 兼容修复（Git Bash 下 mkdir 锁回退）。_(retired 2026-10-14)_
- **Done (2026-10-14) 分级项目地图建立：20 份 CLAUDE/AGENTS/GEMINI 指南，链接与行数校验通过。_(retired 2026-10-14)_
- **Done (2026-10-14) 真实 LLM 验证 7/7 通过（gpt-6.1-sol，经 ~/.codex 配置；Key 入加密 vault）。_(retired 2026-10-14)_
- **Done (2026-10-13) Phase-1 全绿验收：F01–F18 全 PASS（32 单测 + 18 集成 + 10 E2E），9 项问题归因修复，报告 artifacts/acceptance-report.md。_(retired 2026-10-14)_
- **Done (2026-10-13) Phase-1 实施完成：设计 11 份 + 三层架构实现 + 测试三层体系。_(retired 2026-10-14)_
- Project memory initialized. _(retired 2026-10-14)_
