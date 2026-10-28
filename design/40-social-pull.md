# 40 · 社交媒体/社区内容拉取（F57 / T52）

状态：2026-10-26 立项实施；验收以本轮 acceptance-report.md 为准。

## 观察（2026-10-26 本机实测）与定位

- 用户诉求：拉取"当前社交媒体"内容作为新能力。**SKILL.md 只是提示词，拉不了数据**——
  真正的挂点必须是工具（engine tool）或连接器（MCP）。
- 本机直连探测（curl，6s 超时）：`hn.algolia.com` **200 可达**；Bluesky/Mastodon/YouTube/
  Reddit 免密端点全部连接失败（无代理网络；且 Node fetch 不走系统代理，与 web_search/
  web_fetch 的直连限制一致，web.js 头注记）。
- 国内平台（微博/知乎/B站/抖音）可达但**无开放读取 API**，硬爬违反 ToS 且随前端改版易碎；
  wb 对应能力是服务端收集（task-parity 证据），不在个人复刻范围。
- 结论：可长期维护的形态 = **keyless 标准接口 + 通用 RSS**，把爬虫责任留在用户自托管
  的 RSSHub（MIT，`docker run -p 1200:1200 diygod/rsshub`），MyAgent 不内置任何平台爬虫。

## 复现设计

### 引擎工具 `social_fetch`（`app/engine/tools/social.js`）

- `kind:'read'`（ask/plan 均可用）；只读 GET，15s 超时，响应 ≤2MB。
- `platform:"hackernews"`：`hn.algolia.com` 公共 API；query 省略 = 首页热帖；返回
  `{title,url,author,points,comments,published,text}` 列表。
- `platform:"rss"`：任意 RSS/Atom feed URL；自研紧凑解析器（RSS2 `<item>`/Atom `<entry>`、
  CDATA、命名实体/数字实体、Atom link 取 rel=alternate）；返回
  `{title,url,published,text}` 列表。国内社交走本机 RSSHub 路由
  （如 `http://localhost:1200/weibo/search/hot`）。
- 上限：≤30 条/次、单条文本 ≤400 字、总计 ≤8000 字；HTTP 非 200 / 非 feed / 传输失败
  一律**错误即值**（`{ok:false,summary}`），不抛出、不重试风暴。
- **明确不支持**：X（付费 API）、Reddit/Bluesky/Mastodon/YouTube keyless 端点（本机不可达）
  ——设计口径为连接器路线：用户在「连接器」自备密钥接入对应 MCP 服务器；
  国内平台反爬不做内置爬虫。代理支持（undici dispatcher）留作后续观察，不在本轮。

### 内置技能 `social-pull`（`skills/social-pull/SKILL.md`）

教模型何时/如何用 `social_fetch`：平台选择表、RSSHub 路由示例（微博热搜/知乎热榜/
B站投稿/抖音博主）、RSSHub 未启动时的告知义务、汇总需带来源/时间/热度、只读不代发。

### 接线

`tools/index.js` 装配（与 web 工具共用注入 fetch 接缝）；引擎 system 的研究纪律句追加
social_fetch 提示。无 daemon 方法、无 UI、无 IPC 变化。

## 验证方法

| 层 | 断言 |
|---|---|
| unit T52 | HN 适配（hits→items、limit、query/首页双形态）；RSS/Atom 解析（CDATA、实体、atom alternate 链接、非 feed→null）；rss 平台 URL 校验与 HTTP 500/非 feed 错误即值；上限（30 条、400/8000 字）；传输失败/未知平台为值；kind=read |
| 真实冒烟 | 本机直连 hn.algolia.com 拉取 3 条真实热帖（实施时已验证，见实施说明） |
| 回归 | web_search/web_fetch（T38）、技能清单（T11b）、全量 verify |

## 降级 / 边界

- RSSHub 是用户自托管组件：未启动时 social_fetch(rss) 返回连接失败值，技能负责如实告知。
- 解析器面向"良构 feed"；畸形 feed 返回 not-a-feed 值而非尽力猜测。
- 不做：代理配置、平台登录态、发帖/回复、定时轮询（定时任务 + social_fetch 可组合实现）。
