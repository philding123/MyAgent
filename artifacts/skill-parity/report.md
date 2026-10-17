# Skill parity：reverse-skill 五步工作流·第 3 步（evidence-check）

- 生成时间：2026-10-17T15:03:12.457Z
- 任务提示词（双端一致）：请分析工作区里 fixture-app.js 的【令牌桶限流器】是怎么实现的：先按逆向分析流程判断分析线并读取程序代码；结论完成后按 evidence-check 技能核对：给出 Evidence 记录表（每条结论标注 fixture-app.js 的行号出处与依据），最后用一段大白话把实现原理讲给完全不懂编程的人听。
- 技能安装：MyAgent 用户目录 18 个 reverse-skill 包技能 + 内置 evidence-check；wb 侧探测其 skills 目录（见下）

| 标准 | MyAgent | wb |
|---|---|---|
| Evidence 出处引用（fixture-app.js:行号 去重数） | 9 | 1 |
| Evidence 记录表 | true | true |
| 大白话原理段 | true | true |
| 通过（≥3 处独立行号出处 + 大白话） | **PASS** | **FAIL** |
| skill_read 调用（MyAgent 引擎事件） | true | — |

wb 技能页证据：wb-skills-page.png（含 evidence-check 是否被识别）。
截图：my-final.png / wb-final.png。原始时间线：my-run.json / wb-run.json。

## 结果解读（2026-10-17）

- **MyAgent PASS**：22 个技能装载（18 个 reverse-skill 包 + 内置 evidence-check 等），引擎事件确认模型调用了 `skill_read('evidence-check')`，产出 9 处独立 `fixture-app.js:行号` 出处、Evidence 表、大白话段——skill 的输出契约被完整执行。
- **wb FAIL（按行号出处契约）**：wb 实际完成了任务且质量很高（大白话比喻出色、自动生成令牌桶流程图、◇1.56），但其 Evidence 以函数名（tryTake/refill）而非行号标注，仅 1 处 `fixture-app.js:行号` 引用。原因：**wb 的技能走市场/插件体系，`~/.workbuddy/skills` 文件投放未被确认生效**（技能页点击未命中：侧栏项为「专家·技能·连接器」），evidence-check 契约只存在于提示词里，模型按自己理解复述。注意：wb-run.json 里 skills-page.hasEvidenceCheck=true 是旧会话文本的误报，以截图为准。
- **结论**：同一工作流提示词下，「技能 + skill_read 全文装载」让 MyAgent 严格执行 evidence-check 输出契约；wb 需经其技能市场安装才能达到同等约束力——这是两条产品在技能分发机制上的真实差异。
- 遗留：`~/.workbuddy/skills/evidence-check/` 探针文件保留（若 wb 未来扫描该目录即自动生效；否则惰性无害，可手动删除）。
