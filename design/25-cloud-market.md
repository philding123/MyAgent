# 25 · 云端技能市场（F25）

> Phase-3。从远端索引搜索并安装技能（对齐 WorkBuddy marketplace-skill-installer）。

## WorkBuddy 观察（证据）

| 证据 | 路径（逆向基线） | 结论 |
|---|---|---|
| `resources/plugins/workbuddy-builtin/.codebuddy-plugin/marketplace.json`（app.asar.unpacked 直读） | `{name, description, owner, metadata, plugins:[{name, description, source, category, version}]}`，category 有 skill/mcp-app/builtin-plugin/welcomeMode/interaction/template | **市场索引结构** |
| `…/skills/marketplace-skill-installer/SKILL.md`（直读） | 工具 `search_and_install_skills`：`{action:'search', keywords:[1–5]}` → `{skills:[{name, display_name, description}]}`；`{action:'install', skill_names:[…]}`（name 逐字复制搜索结果，装前必须重搜）；结果逐项 `installed/already_installed/refused`；不升级已装技能 | **安装工具协议与语义** |

## 复现设计

- 模块：`app/daemon/market.js`。
- 源协议：settings `market.url`（可多个，逗号分隔；空=仅本地市场禁用）指向 `index.json`，
  结构对齐证据（`{name, description, plugins:[…]}`），每插件加个人市场必需的
  完整性字段：`sha256`（zip 包摘要）与绝对 `source` URL。
- daemon 方法：
  - `market.search {keywords}` → 合并各源的 `{name, display_name, description, version, installed}`；
  - `market.install {names}` → 逐项：下载 zip（超时 60s）→ sha256 校验（不符 → `refused`，原因 `hash_mismatch`）→
    复用既有 zip 解压 + `installSkill()` 装入用户技能目录 → 返回
    `installed / already_installed / refused`（语义照搬证据：不升级已装技能，重装同版本算 already）。
- 引擎工具 `market`（action search/install），并新增内置技能
  `skills/marketplace-skill-installer/SKILL.md`（改写自证据，工具名对齐）。
- 安全：仅 https（测试回环 http 白名单 `market.allowInsecure`，默认 false）；
  下载内容 sha256 必须与索引一致（索引源自身是信任锚，个人自管）；
  解压走既有安装器（已有目录逃逸防护）。

## 验证方法

| 层 | 断言 |
|---|---|
| int T25 | 本地 HTTP 服务当市场源（含合法 zip + 篡改 zip 两个用例）：search 命中关键词；install → 技能出现在 `skills.list`；重复安装 → `already_installed`；sha256 不符 → `refused(hash_mismatch)` 且不留残件 |
| unit T25a | 关键词匹配（多词 AND）；URL 安全策略：默认拒 http（白名单开才放行） |
| e2e T25（冒烟步 `market-status`） | `market.status` 返回 `{sources, allowInsecure, lastIndexFetch}` 字段齐全 |
| 手工 | 自建 GitHub Pages 索引装一个真实技能 |

## 降级路径

- 源不可达：搜索返回空 + 上次成功抓取时间戳；不阻塞本地技能功能。
