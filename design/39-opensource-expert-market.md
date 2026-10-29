# 39 · 开源专家市场（F56 / T51）

状态：2026-10-25 立项实施；验收以本轮 acceptance-report.md 为准。

## WorkBuddy 观察（证据）与偏离声明

- wb 的「专家」是云端专家/专家团队体系（`experts/teams` 相关 chunk、`disable-agent-teams` 证据，
  见 `artifacts/wb-feature-inventory.md` §1 与 `design/35` §偏差）。该体系绑定腾讯云端服务，
  属于 `90-deferred` 排除项，**不复刻**。
- **MyAgent 替代路线（本设计）**：接入开源专家角色目录
  [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)（MIT）。
  上游是 persona Markdown（frontmatter `name/description/color/emoji/vibe` + 正文提示词），
  不是 `SKILL.md` 技能、也不是可独立运行的 Agent——**导入后成为 F41 预设**，
  由既有 `sessions.setPreset` 绑定会话、persona 通道注入。
- 偏离理由：个人使用需要「专家」有真实内容可挑，而非空预设页；开源 persona 与本项目
  「专家 = 命名提示预设」的既有裁决（design/35）零冲突，且 MIT 许可允许内置再分发。

## 复现设计

### 目录固化（vendoring）

- `scripts/vendor-agency-experts.mjs [--repo <clone>] [--ref <sha>]` 生成 `market/agency-experts/`：
  `index.json` + `experts/<id>.md`（**逐字保留上游字节**）+ `LICENSE` + `THIRD_PARTY_NOTICES.md`。
- 精选 33 位 = 批1 26 位（工程 10 / 设计 4 / 产品 3 / 测试 5 / 安全 3 / 研究 1）
  + 批2 金融 7 位（2026-10-25：finance 5 + 支付计费/FinOps 2），锁定上游 commit
  （index `metadata.commit`，homepage 链到该 commit 的 blob）；中文 `display_name/description_zh`
  与 `division_zh` 是 MyAgent 目录自有元数据，不回写上游。
- 每位专家记录 md 文件 `sha256`；读取前重算，不符 → `refused/tampered`（fail-closed，
  同 F53 `tree_sha256` 思路）。`market/**` 已在 `.gitattributes` 设 `-text`，防换行改写。
- 升级上游 = 重跑脚本（换 commit）+ 跑 T51；不做运行时自动更新。

### daemon（`app/daemon/expert-catalog.js` + 方法表）

- `experts.list` → `{catalog, experts:[{id,name,display_name,description(_zh),division(_zh),emoji,license,homepage,installed}]}`；
  `experts.read {id}` → 校验 sha256 后返回 `{...,prompt}`（正文，frontmatter 已剥离）+ 溯源字段；
  `experts.import {id}` → `installed / already_installed / refused`（语义对齐 `market.install`）。
- 导入 = `presets.create`，携带 `meta` 溯源：`source:"builtin:agency-experts/<id>"`、
  `expertId/upstream/homepage/license/upstreamCommit/importedAt`（presets.store 已扩展透传 `meta`）。
  重复导入按 `meta.source` 识别 → `already_installed`，不重复建。预设删除后可再次导入。
- `experts.builtin=false`（settings）关闭目录，三方法分别返回空表/抛错/refused，
  与 `market.builtin` 行为对齐。测试可用 `MYAGENT_EXPERT_BUILTIN` 覆盖目录路径。
- **专家不是技能**：不进 `skills/`、不进引擎工具面、不参与 SKILL 渐进披露；
  也**不是 A2A 委派**——`agent_delegate` 语义不变，二者不得混用。

### renderer（专家 Tab，F54 页内扩展）

- 工具行：分区 chip（全部/已导入/工程/设计/产品/测试/安全/研究/金融）+ 搜索框，同时过滤
  「我的专家」（presets）与「开源专家市场」两个网格。
- 目录卡片：emoji 图标 + 中文名 + 分区标签 + 中文简介 + 「查看」「导入/已导入」。
- 「查看」弹模态预览：**提示词一律 `textContent` 纯文本渲染**（persona 是不可信内容，
  禁 innerHTML/禁 markdown 渲染），头部显示分区 · MIT · 上游 commit；Esc/遮罩/关闭钮退出。
- 「导入」即时反馈：卡片翻「已导入」、我的专家计数 +1、卡片带「目录导入」来源标记；
  拒绝时打开模态展示 reason。会话绑定仍走设置页/既有预设机制。

## 验证方法

| 层 | 断言 |
|---|---|
| unit T51 | 真实固化目录：33 位、七分区（含金融 ≥5）齐全、id 唯一、sha256/homepage 锁 commit；read 剥 frontmatter 返回正文与溯源；import 建预设且 prompt 逐字一致、meta 溯源完整；重复导入 dedup；篡改一位字节 → tampered 拒绝 |
| int T51 | 真实 daemon：list/read/import 往返；导入落入 `presets.list` 且带 source；未知 id 返回 refused 值（不建预设）；`experts.builtin=false` 关闭 |
| 审计 T49 | 专家页目录 ≥20 卡；搜索「后端」命中 1；安全分区筛选；查看模态纯文本+溯源+Esc 关闭；导入 → 我的专家 +1、卡片翻已导入、重复导入不重复建 |

## 降级 / 边界

- 目录随应用分发，无网络依赖；上游更新只能通过重跑 vendor 脚本（个人使用节奏足够）。
- persona 质量/口径以上游为准；中文卡片名与简介是目录侧改写，正文不翻译不裁剪。
- 不做：目录自动刷新、多远程专家源、专家团队编排、按专家自动委派 Agent——均为后续观察项。
