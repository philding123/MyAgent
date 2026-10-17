# 任务级复刻对比测试：REA skill 调研报告（HTML 交付）

- 日期：2026-10-16 深夜 · 驱动脚本：`scripts/task-parity.mjs`（新增）
- 任务提示词（双端一致）：「帮我做一下REA skill的调研报告以html文件交付」
- MyAgent：真实应用 + 真实 LLM 配置（api.20230112.xyz / gpt-6.1-sol，vault 密钥），会话工作区 `artifacts/task-parity/myagent-ws`
- wb：实机 V5.8.3（CDP 9333 驱动，Deepseek-V4.1-Flash，允许完全访问），消耗用户云端配额 ◇2.74

## 一句话结论

**wb 4 分钟完成交付（58KB HTML 报告 + 内置预览 + 28 源标注），MyAgent 2 分钟静默失败（0 产物，17 次工具调用后撞 16 步上限，UI 无任何提示）。** 差距不是模型能力，是 4 个结构性缺口：规划可见性、服务端联网检索、专门交付步骤、步数预算与续跑。

## 双端执行路径

### wb（计划式，全部完成）

| 阶段 | 行为 |
|---|---|
| 计划 | 深度思考 → 生成子任务清单（收集/提取/查询/搜索），配额预测 ◇0.56~8.2 |
| 检索 | 服务端联网收集：REA 资料 → github.com → rea.tools 校验 → 提取仓库指标 → 版本/发布节奏 → 下载量对比 → 合规风险搜索（28 个来源，不受本机网络限制） |
| 上下文 | 界面明示压缩策略「只保留关键上下文，目标和约束最重要」 |
| 交付 | **present_files 专用交付工具**：HTML 落到用户可见目录 `C:\Users\phil\WorkBuddy\<时间戳>\`（58,045B）→ 产物索引（artifact-index）→ 会话内文件卡片 + 内置预览窗打开 |
| 收尾 | 共消耗 ◇2.74 显示；追问建议（导出 Word / 发布在线链接）；文件历史备份（modify_backup + 内容寻址回滚） |

### MyAgent（扁平 ReAct 工具流，失败）

| # | 工具 | 动作 | 结果 |
|---|---|---|---|
| 1 | list_dir | 工作区定向 | ✅ |
| 2-3 | browser | bing 搜索 + content | ✅ |
| 4 | browser | github.com/morluto/rea | ❌ 连接超时 |
| 5 | run_command | curl 抓取 | ❌ exit 1（连接重置） |
| 6-7 | list_dir + run_command | 查交付目录、再试 curl | ❌ exit 35（SSL 重置） |
| 8-13 | browser×6 | **自适应改走 rea.run 镜像站**（中英社区指南）+ bing site: 检索 | ✅ 共抓 6.9K 字符 |
| 14-15 | browser | snapshot + click r7（页面交互找链接） | ✅ |
| 16 | browser | raw.githubusercontent.com | ❌ 连接重置 |
| 17 | browser | registry.npmjs.org | ✅（此后引擎停止） |

17 次调用中 **4 次失败，全部源于本机网络对 GitHub 系的干扰**；agent 的镜像站自适应是亮点，但随后撞上引擎 16 步上限：**done(reason=max-steps) 被渲染层静默吞掉**——无结束语、无失败说明、无部分成果、无「继续」入口。

## 结构性偏差清单（修复优先级排序）

| # | 偏差 | wb 证据 | MyAgent 现状 | 修复方向 |
|---|---|---|---|---|
| P0-1 | **步数上限 + 静默终止**：长任务必然中断且不可见 | 无固定步数上限，子任务驱动直到完成 | `engine/index.js` `for step<16`；max-steps 在 UI 无任何呈现 | 上限提升/可配置；max-steps 与 error 终态必须在 UI 显式呈现并提供「继续」（复用引擎 history 续跑） |
| P0-2 | **无服务端联网检索**：客户端 browser 完全暴露在本机网络干扰下 | 专用联网收集工具（globe 子任务），检索不受本机 GFW 影响 | 工具面无 web_search/fetch；browser 走本机 Edge | 新增 web_search / http_fetch 工具（可配代理或服务端源）；或 browser 会话内置代理 |
| P0-3 | **无交付步骤语义**：任务产物没有「交付」概念 | present_files → 用户可见目录 + 产物索引 + 卡片 + 预览 + 追问 | write_file 写工作区 + artifact 卡片（本次甚至没走到） | 新增 present_file 交付工具（复制到 `%USERPROFILE%\MyAgent\<时间戳>\`，入 artifact 索引，渲染 wb 同款文件卡） |
| P1-1 | 规划不可见 | 深度思考 + 子任务清单 + 进度 | 扁平工具流，无计划展示 | plan 模式产出 todo 清单事件，渲染为 wb 同款子任务组 |
| P1-2 | 无进度/成本度量 | 已处理时长、配额消耗/预测、模型名常显 | 无任何进度指标 | 事件流补 step 计数/耗时/token 估算，composer 区常显 |
| P1-3 | 上下文管理缺失 | 「只保留关键上下文」自动压缩 | 16 步全量 history 直送 | 长历史压缩（保留 system+目标+近 N 轮） |
| P2-1 | 文件历史/回滚 | modify_backup + 内容寻址 file-rollback | 无 | 观察必要性 |

## 其他取证发现（非路径偏差）

1. **真实 home 数据丢失**：sqlite 多次损坏（`%APPDATA%/myagent/data` 下 9 组 .corrupt 残留）后回退 JSON store，**llm.* 设置全部丢失**（本次测试不得不经 settings RPC 恢复 baseUrl/model）。sqlite 反复损坏的根因值得单独排查。
2. wb 交付物质量：58KB 结构化报告（定位/增长/架构/能力边界/竞品格局/合规风险 + 落地评估），结论「能用，但别乱用」，多源交叉核实声明。MyAgent 即便走完路径，交付形态（write_file 到工作区）也缺少 wb 的「用户可见交付目录」一步。
3. harness 教训：wb 动画（轮播/吉祥物）会让 body.innerText 持续变化，空闲判定失效——后续监控应对截图/文本做变更降噪，或改订阅 wb 的会话状态事件。

## 证据索引

（入库时保留关键态截图；全量 116 张截图可由 `scripts/task-parity.mjs` 复跑再生）

- `my-timeline.json` + `my-007-final.png`：修复前 MyAgent 终态——17 次调用后静默 idle，零产物
- `wb-009-008.png`（wb 执行中：子任务清单/配额预测/上下文压缩提示）、`wb-040-039.png`（wb 完成态：文件卡 + 预览 + ◇2.74）
- `my-010-final.png`：验收轮终态（F45–F47 修复后自然完成）；`myagent-ws/` 为验收轮工作区（26KB 报告 + 交付副本）
- `wb-deliverable.html`（58,045B，wb 实际交付物取证副本）
- wb 产物索引：`C:/Users/phil/.workbuddy/artifact-index/928d1d01-*.json`（sourceTool: **present_files**）
- wb 会话工作区备份：`C:/Users/phil/.workbuddy/workspace/sessions/928d1d01-*/`

## 验收轮（2026-10-17，D11 P0 修复后复跑）

同任务复跑 MyAgent 腿（F45–F47 已上线，gpt-6.1-sol）：

| 指标 | 修复前（10-16） | 修复后（10-17） |
|---|---|---|
| 终态 | 16 步上限静默终止，零产物 | **自然完成**（24 次调用 < 64 预算） |
| 交付 | 无 | **present_file 交付** `C:\Users\phil\MyAgent\2026-10-17-01-57-28\REA_skill_调研报告.html`（26,423B，title 正常） |
| 工具路径 | browser×11 + run_command×2，全部本机网络裸奔 | **web_search×2 + web_fetch×12**（抓到 SKILL.md 33KB / installation.md 68KB / releases 62KB / 仓库元数据 37KB）+ write_file×4 + run_command×5 + present_file×1 |
| 网络失败 | 4 次，全部阻断性打击 | 6 次但全部值错误继续（间歇性 fetch failed/超时，未阻断） |
| 产物卡 | 无 | 工作区 + 交付目录双卡片，点击预览 |

与 wb 的剩余差距（非本轮范围）：报告详尽度（26KB vs 58KB，模型/提示词调优问题）、
服务端级检索可靠性、规划可见性与成本度量（D11 P1 项）。

T38/T39/T40 进验收报告，`npm run verify` ALL GREEN（T01–T40）。
