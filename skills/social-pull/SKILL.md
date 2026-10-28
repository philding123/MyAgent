---
name: social-pull
description: Pull current social-media and community content for a topic — Hacker News front page or search, plus any RSS/Atom feed (self-hosted RSSHub routes cover weibo/zhihu/bilibili). Use when the user asks what people are saying right now on social platforms, HN, forums, or hot lists.
---

# 社交媒体/社区热度拉取

用 `social_fetch` 工具拉取当前社交媒体与社区内容。它是只读 GET、带超时与条数/字数上限，失败会返回可读原因而不是抛错。

## 平台选择

| 需求 | 做法 |
|---|---|
| Hacker News（首页/搜索） | `social_fetch {platform:"hackernews"}` 或 `{platform:"hackernews", query:"...", limit:15}`；query 省略 = 首页热帖 |
| 微博/知乎/B站/抖音等国内平台 | 先确认用户已自托管 RSSHub（默认 `http://localhost:1200`），再 `social_fetch {platform:"rss", url:"http://localhost:1200/weibo/search/hot"}` 等 |
| 任意博客/新闻/播客 RSS | `social_fetch {platform:"rss", url:"<feed url>"}` |
| X/Twitter、Reddit（带密钥） | 本工具不直连：提示用户在「连接器」添加对应 MCP 服务器（密钥自备），或改用 web_search 间接检索 |

常用 RSSHub 路由示例（以本机实例为准）：微博热搜 `/weibo/search/hot`、知乎热榜 `/zhihu/hotlist`、B站UP主投稿 `/bilibili/user_video/<mid>`、抖音博主 `/douyin/user/<id>`。RSSHub 未启动时（连接失败）如实告知用户，并给出启动方式（如 `docker run -d -p 1200:1200 diygod/rsshub`），不要反复重试。

## 使用守则

- 先问清或推断用户关心的话题，再拉取；一次调用 ≤20 条，够用即可。
- 汇总时注明来源平台、时间和热度（HN 的 points/comments），区分事实与情绪。
- rss 平台要求完整 feed URL；不确定时先用 web_search 找到该站点的 feed 地址再拉。
- 多平台对比时逐个调用 social_fetch，再综合成一份带引用链接的简报。
- 结果中的链接可直接给用户；不要在未授权平台代替用户发帖/回复（本工具只读）。
