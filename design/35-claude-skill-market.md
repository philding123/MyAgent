# 35 · 内置 Claude 技能市场（F53）+ wb 侧栏六项与「专家·技能·连接器」页（F54）

> Phase-11。把 Anthropic 公开分享的 Agent Skills（github.com/anthropics/skills）随 MyAgent
> 内置为离线技能市场，并把技能入口对齐 WorkBuddy v5.8.2 的侧栏与主区技能页。

## WorkBuddy 观察（证据）

| 证据 | 路径 | 结论 |
|---|---|---|
| 实机 CDP 几何 `navNewTask {y:96, h:202}`、`navAssistant {h:32, radius:8px}`、`sectionTasks {y:323}` | `artifacts/pixel-evidence/wb-live-tokens-main.json` | 侧栏导航**恰好六行**（6×32 + 5×2 = 202），任务分组标签 y=323 |
| 实机 bodyText「新建任务 / 助理 BETA / 专家·技能·连接器 / 定时任务 / 资料库 / 更多 灵感」「发现应用」 | `artifacts/pixel-evidence/wb-live-geometry.json` | 六行文案与「发现应用」药丸 |
| 实机截图取色：窗带+侧栏 `#f7f7f7`、主区 `#fff`、x=359 分隔线 `#f2f2f2`、导航激活 `#ebebeb` 加粗、底部用户行上 `#e6e6e6` 通栏细线（57px）、hero 场景切换为 `#f2f2f2` 分段轨道+白色激活块、七个 chip 左对齐 composer、composer 灰托盘（#ebebeb→#f5f5f5）只包卡片+子行、建议条间距 12px | `artifacts/pixel-evidence/wb-live-home.png`（1.5× 截图；比对脚本 `scripts/pixel-match-live.mjs`） | 主窗 home 态像素规格 |
| 侧栏会话行右侧相对时间「21小时前 / 2天前 / 9月7日 / 6月13日」；空间行带文件夹图标、会话缩进到 x=48 | `wb-live-home.png`、`wb-skills-page.png` | 时间列与空间行 |
| skill-parity：wb 技能经「专家·技能·连接器」→ 技能子 Tab 的市场体系分发 | `artifacts/skill-parity/report.md` | 技能入口在主区页面，不是设置窗 |
| marketplace.json 索引结构 `{name, description, owner, metadata, plugins:[{name, description, source, category, version}]}` | design/25 | 内置目录沿用同一结构 |

**未取得**：wb「专家·技能·连接器」页内部的实机截图（skill-parity 自动化点击未命中该页）。
页内布局（标题+三 Tab、筛选 chip、两列卡片网格、卡片右侧动作钮）按 wb 令牌与卡片语言设计，
**不声称像素一致**；待取得实机截图后按本文件流程回改。

## 复现设计

### F53 内置 Claude 技能市场

- **目录**：`market/claude-skills/`（`index.json` + `skills/<name>/` + `THIRD_PARTY_NOTICES.md`），
  由 `scripts/vendor-claude-skills.mjs [--repo <clone>] [--ref <sha>]` 生成，锁定上游 commit。
- **许可裁决**：
  - 15 个 Apache-2.0 技能原样内置（保留各自 LICENSE.txt；doc-coauthoring 无独立 LICENSE 文件，
    按上游 README「除四个文档技能外均为 Apache 2.0」处理）。
  - docx/pdf/pptx/xlsx 为 **source-available、非开源**：其 LICENSE 明确禁止在 Anthropic 服务之外
    复制、留存或分发。目录只列出（`installable:false` + `reason` + `homepage`），**不内置、不代下载**；
    UI 显示「仅查看」打开上游页面，引擎 `market install` 返回 `refused` 并带原因。
- **索引字段**（在 F25 结构上扩展）：`display_name`（中文卡片名）、`description`（上游原文）、
  `description_zh`（一句话中文）、`group`（creative/dev/enterprise/document）、`author`、`license`、
  `homepage`、`installable`、`source:"builtin:skills/<name>"`、`tree_sha256`。
  目录顺序 = 脚本内 META 顺序（通用价值高的在前，Claude 产品类元技能在后）。
- **完整性**：`tree_sha256` = 按相对路径排序后 `path\0bytes\0` 的 sha256（`market.js#treeHash`，
  脚本与运行时共用一份实现）；安装前重算，不符 → `refused(hash_mismatch (builtin tree))`，不留残件。
  `.gitattributes` 对 `market/**` 设 `-text`，防 Windows autocrlf 改写字节。
- **Market**：`new Market({builtin:[dir], …})` 同步加载目录；`list()` 先内置后远端；
  `search` 匹配 name/display_name/description/description_zh（中文名可搜）；
  `install` 对 `builtin:` 源走复制安装（`installSkill` 复制语义不变，已装不升级）。
  设置 `market.builtin=false` 关闭内置目录。
- **RPC**：新增 `market.list {refresh?}` → `{catalogs, plugins}`（主区技能页用）；
  `market.status` 增 `builtin:[{id, plugins}]`。引擎 `market search` 结果附 `installed/installable/reason`，
  模型不再重试被拒条目（内置技能 marketplace-skill-installer 同步更新）。
- **SKILL.md 解析修正**：frontmatter 支持 YAML 块标量（`>`/`|`/`|-`）与单/双引号字符串
  ——Anthropic 技能普遍使用；修正前 `description: |` 被解析成字面量 `|`
  （本仓库 marketplace-skill-installer 自身即受影响）。
- **跨平台 zip**：`daemon/unzip.js` 纯 JS 解压（stored/deflate，zip-slip/符号链接/加密条目整体拒绝、
  先校验后落盘）取代仅 Windows 可用的 PowerShell Expand-Archive。

### F54 侧栏六项 + 「专家·技能·连接器」页

- 侧栏导航 = wb 六行：新建任务 / 助理 BETA / 专家·技能·连接器 / 定时任务 / 资料库 / 更多（右侧「灵感」）；
  原「技能市场/技能/连接器/记忆/全局搜索」五项收进「更多」弹出菜单（记忆、全局搜索、连接器、云端市场源）。
- 品牌行右侧「发现应用」药丸 → 打开技能页「全部」。
- 「专家·技能·连接器」在**主区**打开（隐藏任务视图），标题 + 三 Tab：
  - **技能**：筛选 chip（全部/已安装/创意设计/开发技术/企业沟通/文档）+ 搜索框；Claude 技能市场横幅
    （可装数 + 上游版本）；两列卡片（分组色块首字母图标、中文名、作者、两行中文简介、动作钮
    安装 / 已安装（再点停用）/ 仅查看）。「已安装」视图并入非市场的本地技能（MyAgent 内置、导入）。
  - **专家**：`presets.list` 卡片（wb 专家 = 命名提示预设的对应物），「管理专家」进设置窗。
  - **连接器**：`connectors.list` 卡片（连接状态 + 工具数），「管理连接器」进设置窗。
- 会话行：标题 + 右侧相对时间（刚刚 / N分钟前 / N小时前 / N天前（<7d）/ M月D日 / YYYY/M/D）；
  cwd = 用户主目录的会话视为无工作空间（daemon 默认 cwd），进「任务 (n)」而非伪空间「root」；
  空间分组为「空间 (n)」+ 带文件夹图标的空间行 + 缩进会话。
- 窗口动作 `openExternal {url}`（仅 https，走既有 `rpc.window`，不新增 IPC 通道）。
- composer：wb 只有一个 ＋，@ 上下文与 / 技能收进 ＋ 弹出菜单；去掉 hint 文案。

## 验证方法

| 层 | 断言 |
|---|---|
| unit T12d | 纯 JS 解压：嵌套 deflate 往返；zip-slip 拒绝且不落任何文件；非 zip 报错 |
| unit T47a | 块标量/引号 frontmatter；目录完整性（15 个 Apache 技能 name/描述/tree 摘要逐一核对，四个文档技能 view-only 且未内置）；builtin 安装复制含 LICENSE、重复 already_installed、pdf refused（许可原因）、篡改一字节 → hash_mismatch 且不落盘；`market.builtin` 关闭 |
| int T47b | 真实 daemon：`market.list` 目录 ≥15、RPC 安装进 `skills.list`（source=user）、installed 状态回显、`market.builtin=false` 隐藏；引擎 `market` 工具 search→install 全链路（mock LLM），搜索结果带 installable 回喂模型 |
| e2e T48 `ui-nav` | 导航六行文案逐字一致、`#sb-nav` 高 202、顶 y=96、会话行带时间、relTime 刚刚/5小时前 |
| e2e T48 `ui-hub` | 打开技能页：任务视图隐藏、卡片 ≥19、横幅「Claude 技能市场」、pdf 卡为「仅查看」；**真实点击**首个未安装卡片的「安装」→ 变「已安装」、「已安装」筛选含它不含 pdf、daemon `skills.list` 可见；冒烟跑在真实数据目录，断言后 `skills.uninstall` 复原 |
| 像素 | `node scripts/pixel-match-live.mjs artifacts/pixel-evidence/wb-live-home.png artifacts/pixel-evidence/p11-my-home.png --t 0.02`（改前 `p11-my-home-before.png`，差异图 `p11-diff-home.png`，技能页 `p11-my-hub*.png`）；home 态对 wb 实机（1920×1200 box 降采样到 1280×800，相同会话布局）pixelmatch：阈值 0.02 下 63.40% → 93.93%，0.05 下 94.96% → 95.96%，0.1 下 96.77% → 96.88%（Linux 字体与 wb 不同，绝对值不与 Windows 历史数据混比，看前后差） |

## 降级 / 偏差

- 文档四件套无法内置（许可）：用户可在 Claude 应用 / Claude Code 中使用；
  MyAgent 侧的 Office 预览（F20）不受影响。
- wb 专家体系（专家团队/云端专家）不复刻，专家 Tab 以预设承载。
