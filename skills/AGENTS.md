# AGENTS.md — skills/（内置技能）

## 职责与定位

随应用分发的默认技能目录（daemon 扫描的第一个根目录，标记 source='builtin'）。格式与 WorkBuddy 内置技能（`plugins/workbuddy-builtin/skills/*`）一致，用户技能装在 `%APPDATA%/myagent/skills/`。

## 格式规范（与 WorkBuddy 对齐）

```
<skill-name>/
├── SKILL.md          # 必须。YAML frontmatter + 正文
│   frontmatter: name / description / allowed-tools(块列表或空) / disable
├── scripts/          # 可选，辅助脚本
└── references/       # 可选，深参考资料
```

- 渐进披露：只有 name+description 进引擎 system（`<skills>` 节），全文由模型经 `skill_read` 工具按需读取。
- `disable: true` 或 UI 关闭 → 不注入清单（registry.overrides）。
- description 写「何时使用本技能」（触发条件），不是功能介绍。

## 铁律

1. 本目录技能视为产品内置件：改名/删除属破坏性变更，需过 T11（scanSkillDir reads builtin sample）。
2. 新技能 description 必须可被模型用于触发判断；加入后跑 `npm run test:int` 的 T11b 确认注入与 skill_read 通路。
3. 引擎侧门控：`skill_read` 只能读已装载清单内的技能（engine/index.js gateTool）。

## 验证

- 单测：T11（解析/扫描/启停）。
- 集成：T11b（system 注入 + skill_read 全文返回给模型）。
