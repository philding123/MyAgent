# 13 · 插件化：技能 / 本地市场 / 记忆（F11 F12 F13）

## F11 技能系统

**WorkBuddy 观察**（证据充分，格式已实读）：
- 内置 20 个技能目录 `plugins/workbuddy-builtin/skills/<name>/`，每个含：
  `SKILL.md`（YAML frontmatter：`name`、`description`、`license`、`allowed-tools`、`disable`）
  + 可选 `scripts/`、`references/`、`assets/` + `.codebuddy-plugin/plugin.json`
  （`category: "skill"`、`workbuddy.kind: "builtin-skill"`、`bundleSegments`）。
- 主市场清单 `.codebuddy-plugin/marketplace.json`：`{name, description, owner, metadata,
  plugins:[{name, description, source, category, version, dependencies}]}`，
  category 有 welcomeMode/interaction/skill/mcp-app/template/builtin-plugin。
- UI chunks：`skills-panel`、`skill-picker`、`skill-selector`、`skill-root-dir`
  （技能根目录可配）、`skill-scan-result-dialog`（扫描结果）。

**复现设计**（daemon/skills.js）：
- 技能根目录：`myagent/skills/`（默认）+ 设置可加用户目录（`settings.skillsDirs`）。
- 扫描：遍历目录找 `SKILL.md`，解析 frontmatter（轻量解析器，支持 `name/description/
  allowed-tools/disable`），返回清单 `{name, description, disable, dir, source:'builtin'|'user'}`。
- 装配：会话系统提示附加「可用技能」节（name+description）；模型可用 `skill_read{name}`
  工具按需读全文（对齐"渐进披露"设计，避免全部塞 prompt）。
- `disable:true` 的技能不注入；`skills.toggle` 可运行时开关。

**验证**：单元测试解析真实格式的样例技能（含 disable、缺字段容错）；集成测试引擎会话中
模型调用 `skill_read` 返回正文。T11。

## F12 技能市场（本地导入版）

**WorkBuddy 观察**：`marketplace-skill-installer` 技能（市场安装器）、`skills-market` UI、
`subscription-gate`（付费门控——本实现排除）。

**复现设计**：本地市场 = 「导入」：
- `skills.install{source}`：source 为本地 zip 或目录路径；zip 解压（校验 SKILL.md 存在）复制到
  用户技能目录；目录则复制。重名 → 报错需 `force`。
- `skills.list` 汇总 builtin+user；UI 技能页展示 + 导入按钮 + 启停开关。
- 不做远程仓库拉取（个人用；远程源留 Phase 3，见 90-deferred）。

**验证**：集成测试打包样例 zip → install → list 出现 → uninstall 移除；重复安装报错。T12。

## F13 记忆与个人化

**WorkBuddy 观察**：`MemorySettingsPanel`（记忆管理面板）、`PersonalizationPanel`（个人化）、
`local-skills-memory` chunk（本地技能记忆）。具体存储格式未逆出（渲染层压缩包，未深挖——
**已知的理解缺口**，实现按合理设计，验收时以"存在且生效"为准而非格式对齐）。

**复现设计**（daemon/memory.js）：
- `memory` 表（kind: fact|preference），UI 面板增删查。
- 引擎每次会话组装 system 时注入偏好节（preference 全量）+ 相关 fact（简单关键词匹配前 10 条）。
- 个人化：`settings.persona`（昵称/语气）注入 system。

**验证**：集成测试设置一条 preference 后，mock LLM 收到的 system 含该偏好文本；UI 增删生效。T13。
