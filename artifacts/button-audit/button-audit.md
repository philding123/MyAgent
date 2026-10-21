# MyAgent 逐按钮行为审计（结果断言，非存在性）

- 时间：2026-10-21T09:49:54.006Z；平台：linux；91/91 PASS
- 每项断言按钮存在的「目的」：daemon 状态、窗口状态、磁盘文件、LLM 实际收到的内容；OS 对话框由 MYAGENT_TEST_SEAMS 队列应答。

| 区域 | 控件 | 预期效果 | 结果 | 实测 |
|---|---|---|---|---|
| 主窗 · 窗带 | band-toggle | 折叠/展开侧栏 | PASS | 360→0→360 |
| 主窗 · 窗带 | band-search | 窗带搜索 → 全局搜索窗（输入框聚焦） | PASS | search window opened, #q focused=true |
| 主窗 · 窗带 | menu-edit | 菜单标签 edit → 弹出该分区的菜单项（非一层套娃） | PASS | 新建任务 / 打开设置 / 撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选 |
| 主窗 · 窗带 | menu-window | 菜单标签 window → 弹出该分区的菜单项（非一层套娃） | PASS | 全局搜索 / 最小化 / 最大化/还原 / 关闭 |
| 主窗 · 窗带 | menu-help | 菜单标签 help → 弹出该分区的菜单项（非一层套娃） | PASS | 使用手册（README） |
| 主窗 · 窗带 | menu-about | 菜单标签 about → 弹出该分区的菜单项（非一层套娃） | PASS | MyAgent — WorkBuddy 个人复刻 / 版本 0.1.0 |
| 主窗 · 窗带 | menu-edit-new | 编辑 → 新建任务 实际执行（进入草稿首页，不建会话） | PASS | home draft, sessions 2 |
| 主窗 · 窗带 | menu-window-search | 窗口 → 全局搜索 实际打开搜索窗 | PASS | opened |
| 主窗 · 窗带 | menu-help-manual | 帮助 → 使用手册 打开 README 预览 | PASS | preview title=README.md |
| 主窗 · 窗带 | win-max | 最大化/还原 改变窗口状态 | PASS | maximized false→true→false |
| 主窗 · 窗带 | win-min | 最小化 让窗口最小化 | PASS | minimized=true, restored |
| 主窗 · 侧栏 | btn-discover | 发现应用 → 主区技能页「全部」 | PASS | hub open on 技能/全部 |
| 主窗 · 侧栏 | btn-new | 新建任务 → 草稿首页（标题「新任务」、输入框聚焦、未建会话） | PASS | {"home":true,"focus":"input","title":"新任务","hero":true} |
| 主窗 · 侧栏 | nav-assistant | nav-assistant → 设置窗「presets」面板 | PASS | panel=presets |
| 主窗 · 侧栏 | nav-tasks | nav-tasks → 设置窗「tasks」面板 | PASS | panel=tasks |
| 主窗 · 侧栏 | nav-library | nav-library → 设置窗「library」面板 | PASS | panel=library |
| 主窗 · 侧栏 | settings-panel-switch | 设置窗已开时再点另一导航 → 切到新面板（不是只聚焦旧面板） | PASS | switched to tasks |
| 主窗 · 侧栏 | nav-hub | 专家·技能·连接器 → 主区技能页 + 导航高亮 | PASS | 23 cards |
| 主窗 · 侧栏 | nav-more | 更多 → 弹出菜单，再点关闭，点外部关闭 | PASS | toggle + outside-close ok |
| 主窗 · 侧栏 | nav-memory | 更多 → nav-memory | PASS | settings/memory |
| 主窗 · 侧栏 | nav-search | 更多 → nav-search | PASS | search window |
| 主窗 · 侧栏 | nav-connectors | 更多 → nav-connectors | PASS | hub/连接器 |
| 主窗 · 侧栏 | nav-market | 更多 → nav-market | PASS | settings/market |
| 主窗 · 侧栏 | btn-settings | 设置 → 设置窗 | PASS | opened |
| 主窗 · 侧栏 | session-row | 点击会话行 → 打开该会话并加载其消息 | PASS | 审计-会话甲 |
| 主窗 · 侧栏 | space-row-session | 空间分组下的会话行 → 打开且面包屑显示空间 | PASS | {"title":"审计-会话乙","space":"审计空间"} |
| 主窗 · 顶栏 | mode-ask | 模式按钮 ask → daemon 持久化 + chip 同步 | PASS | session.mode=ask |
| 主窗 · 顶栏 | mode-plan | 模式按钮 plan → daemon 持久化 + chip 同步 | PASS | session.mode=plan |
| 主窗 · 顶栏 | mode-craft | 模式按钮 craft → daemon 持久化 + chip 同步 | PASS | session.mode=craft |
| 主窗 · 顶栏 | btn-terminal | 终端 → 面板打开，键入命令真的执行并回显 | PASS | echoed AUDIT_TERM_42 |
| 主窗 · 顶栏 | btn-preview | 预览 → 选文件 → 预览窗显示该文件内容 | PASS | preview shows the picked file |
| 主窗 · 顶栏 | btn-preview-cancel | 预览 → 取消选择 → 不开窗 | PASS | no window |
| 主窗 · 顶栏 | btn-search | 顶栏搜索 → 搜索窗 | PASS | opened |
| 主窗 · 技能页 | hub-chip-installed | 筛选「已安装」 → 只剩已安装技能 | PASS | evidence-check,marketplace-skill-installer,note-organizer,word-count |
| 主窗 · 技能页 | hub-chip-creative | 筛选「creative」 → 只剩该分组 | PASS | 5 cards |
| 主窗 · 技能页 | hub-chip-dev | 筛选「dev」 → 只剩该分组 | PASS | 5 cards |
| 主窗 · 技能页 | hub-chip-enterprise | 筛选「enterprise」 → 只剩该分组 | PASS | 5 cards |
| 主窗 · 技能页 | hub-chip-document | 筛选「document」 → 只剩该分组 | PASS | 4 cards |
| 主窗 · 技能页 | hub-search | 搜索框 → 按名称/中文名过滤 | PASS | MCP→mcp-builder,claude-api,academy-guide; 主题工厂→theme-factory; empty state |
| 主窗 · 技能页 | hub-install | 卡片「安装」 → 技能装入用户目录，按钮变「已安装」 | PASS | installed to skills/mcp-builder |
| 主窗 · 技能页 | hub-toggle | 「已安装」再点 → 停用（引擎不再加载），再点 → 启用 | PASS | disable → enable round trip |
| 主窗 · 技能页 | hub-view-only | 「仅查看」 → 打开上游 https 页面，不安装 | PASS | opened upstream page |
| 主窗 · 技能页 | hub-tab-experts | Tab 专家 → 显示预设 | PASS | preset card shown |
| 主窗 · 技能页 | hub-manage-experts | 管理专家 → 设置窗「presets」 | PASS | settings/presets |
| 主窗 · 技能页 | hub-tab-connectors | Tab 连接器 → 显示连接器与连接状态 | PASS | auditmcp 已连接 · 1 个工具 |
| 主窗 · 技能页 | hub-manage-connectors | 管理连接器 → 设置窗「connectors」 | PASS | settings/connectors |
| 主窗 · 技能页 | hub-tab-skills | Tab 技能 → 回到技能卡片 | PASS | ok |
| 主窗 · 首页与输入区 | hero-pills | 场景切换 办公/开发/设计 → 激活态与 chip/建议随场景变化 | PASS | 代码审查\|修复 Bug\|写单元测试\|解释代码\|重构模块\|搭建 MCP 服务\|写技术文档 |
| 主窗 · 首页与输入区 | hero-chip | chip → 填入输入框并聚焦 | PASS | 创作文档 |
| 主窗 · 首页与输入区 | suggestion | 建议条 → 填入输入框 | PASS | 做一张应收、应付和开票查询表 |
| 主窗 · 首页与输入区 | btn-plus | ＋ → 弹出 @/技能 菜单，点外部关闭 | PASS | ok |
| 主窗 · 首页与输入区 | sub-workspace | 选择工作空间 → 选目录 → 首条消息建的会话 cwd=该目录 + 归入空间 | PASS | cwd=/tmp/myagent-audit-fx-zIYwft/audit_workspace |
| 主窗 · 首页与输入区 | sub-mode-draft | 草稿态选「只读问答」 → 首条消息建的会话 mode=ask（引擎按 ask 跑） | PASS | mode=ask |
| 主窗 · 首页与输入区 | sub-mode-session | 会话中 chip 菜单切到「计划模式」 → daemon 持久化 | PASS | topbar (chip hidden in task view) |
| 主窗 · 首页与输入区 | btn-context | ＋ → @ 添加上下文 → 选文件 → 发送后 LLM 收到文件内容 | PASS | LLM user message carries the file content |
| 主窗 · 首页与输入区 | btn-slash | ＋ → / 调用技能 → 选技能 → 发送后 LLM 收到该技能正文 | PASS | LLM got the mcp-builder SKILL.md body |
| 主窗 · 首页与输入区 | composer-model | 模型 chip → 设置窗「model」面板，显示当前模型 | PASS | chip=audit-model → settings/model |
| 主窗 · 首页与输入区 | btn-send | 发送（Enter 与按钮）→ 草稿物化为会话 + 回复渲染 + 消息落库 | PASS | two turns rendered + persisted |
| 主窗 · 首页与输入区 | btn-send-empty | 空输入点发送 → 不建会话、不请求 LLM | PASS | no-op |
| 主窗 · 运行中控件 | confirm-approve | plan 模式写文件 → 批准条「Approve」→ 文件真的写入 | PASS | approved.txt written |
| 主窗 · 运行中控件 | confirm-deny | 批准条「Deny」→ 文件不写入，模型收到拒绝 | PASS | denied, not written; s=c6c3c9 |
| 主窗 · 运行中控件 | artifact-card | 产物卡片 → 预览窗打开该文件 | PASS | preview of approved.txt |
| 主窗 · 运行中控件 | continue | 步数上限 → 「继续」按钮 → 同一引擎继续并完成 | PASS | continued |
| 设置窗 | settings-nav | 左侧 17 个导航 → 各自面板显示、其余隐藏 | PASS | appearance,model,engine,update,presets,tasks,library,market,skills,connectors,memory,im,a2a,sync,sandbox,selfcheck,data |
| 设置窗 | settings-search | 搜索设置项 → 只留匹配导航 | PASS | connectors |
| 设置窗 | theme-select | 主题 深色 → 设置窗与主窗都变深色并持久化 | PASS | cross-window + persisted |
| 设置窗 | llm-fields | 模型 Base URL / Model 改动 → 持久化；API Key → 进 vault 不落明文 | PASS | model persisted, chip follows, key in vault only |
| 设置窗 | btn-test-llm | 测试连接 → 对 mock 端点 OK；坏地址 → 显示失败 | PASS | OK / fail: fetch failed |
| 设置窗 | prewarm-chk | 预热进程池 → 设置持久化且引擎池真的起/停空闲进程 | PASS | pool up then drained |
| 设置窗 | presets | 创建预设 → 列表出现；选中 + 删除 → 消失 | PASS | create + remove |
| 设置窗 | tasks | 定时任务 创建/选中删除/刷新 | PASS | create(30min) / refresh / remove |
| 设置窗 | library | 资料库 添加文件 → 引擎可读；选中移除；刷新 | PASS | add / refresh / remove |
| 设置窗 | connectors | 连接器 添加并连接 → 已连接；停用/启用；移除；刷新 | PASS | add/connect, toggle, remove, bad-args error |
| 设置窗 | update | 清单 URL 持久化；检查更新（不可达清单）→ 如实报错；应用更新（无已下载）→ 如实报错 | PASS | error: fetch failed / error: nothing ready to apply |
| 设置窗 | market-panel | 云端市场 搜索/安装首个结果（内置目录）+ 源设置持久化 | PASS | search → install webapp-testing; url/insecure persisted |
| 设置窗 | sync | 同步 保存目标/立即推送（文件落到目录）/立即拉取 | PASS | pushed 9 / applied 0 / auto toggle |
| 设置窗 | sandbox | 沙箱后端选择 → 持久化；云端字段持久化 | PASS | backend/url/id persisted, key → vault |
| 设置窗 | a2a | A2A 开关 → 端点真的可访问（agent card），关 → 不可访问 | PASS | card MyAgent then down |
| 设置窗 | skills-panel | 技能 导入目录 → 安装；勾选框停用/启用；uninstall 卸载 | PASS | import / toggle / uninstall |
| 设置窗 | memory | 记忆 添加 → 下条消息 system 带上；× 删除 → 消失 | PASS | reached system prompt, then deleted |
| 设置窗 | im | IM 保存 token（vault）/ 启动（假 token → 如实报错）/ 停止 | PASS | telegram → error (Token invalid or expired) |
| 设置窗 | export | 导出会话 JSON → 真的产出含会话的 JSON 文件，Key 已脱敏 | PASS | 10 sessions exported |
| 设置窗 | clear | 清空全部数据 → 取消不删；确认后会话与记忆清空，主窗侧栏同步 | PASS | 10 → 0, sidebar synced |
| 设置窗 | settings-close | × 关闭 → 设置窗关闭 | PASS | closed |
| 搜索窗 | search-enter | Enter → 结果列表（任务 + 文件） | PASS | 2 results (task + file) |
| 搜索窗 | search-tabs | Tab 任务/文件/全部 → 结果按类型过滤；空查询 → 空态 | PASS | 任务 1 / 文件 1 / 空态 ok |
| 搜索窗 | search-keys | ↑↓ 移动选中，↵ 打开选中任务 → 主窗打开该会话 | PASS | opened 审计-搜索目标 in main |
| 搜索窗 | search-click-message | 点击任务结果 → 主窗打开该会话，搜索窗关闭 | PASS | opened + closed |
| 搜索窗 | search-click-file | 点击文件结果 → 预览窗打开该文件 | PASS | preview findme.txt |
| 搜索窗 | search-esc | ESC → 搜索窗关闭 | PASS | closed |
| 主窗 · 窗带（收尾） | win-close | 关闭 → 主窗关闭，最后一个窗口关闭后应用退出 | PASS | window closed, app exited |
