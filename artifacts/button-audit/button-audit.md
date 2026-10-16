# MyAgent 主窗逐按钮行为审计（2026-10-16T00:23:02.953Z）

| 按钮 | 功能 | 结果 | 说明 |
|---|---|---|---|
| band-toggle | 折叠/展开侧栏 | PASS | 360→0→360 |
| band-search | 窗带搜索钮 → 全局搜索窗 | PASS | 搜索窗出现 |
| menu-edit | 菜单标签 编辑(E) → 原生菜单弹出 | PASS | 点击无异常；原生弹层为 OS 层，不在页面截图内（见 design/31） |
| menu-window | 菜单标签 窗口(W) → 原生菜单弹出 | PASS | 点击无异常；原生弹层为 OS 层，不在页面截图内（见 design/31） |
| menu-help | 菜单标签 帮助(H) → 原生菜单弹出 | PASS | 点击无异常；原生弹层为 OS 层，不在页面截图内（见 design/31） |
| menu-about | 菜单标签 关于(A) → 原生菜单弹出 | PASS | 点击无异常；原生弹层为 OS 层，不在页面截图内（见 design/31） |
| win-max | 最大化/还原 | PASS | innerWidth 1200→2560→1200 |
| win-min-close | 最小化/关闭按钮存在 | PASS | {"min":true,"max":true,"close":true} |
| nav-presets | 助理（预设） → 设置窗对应面板 | PASS | active panel=presets |
| nav-market | 技能市场 → 设置窗对应面板 | PASS | active panel=market |
| nav-tasks | 定时任务 → 设置窗对应面板 | PASS | active panel=tasks |
| nav-library | 资料库 → 设置窗对应面板 | PASS | active panel=library |
| nav-skills | 技能 → 设置窗对应面板 | PASS | active panel=skills |
| nav-memory | 记忆 → 设置窗对应面板 | PASS | active panel=memory |
| nav-search | 侧栏全局搜索 → 搜索窗 | PASS | 搜索窗出现 |
| session-open | 点击会话行 → 打开会话（面包屑+标题） | PASS | {"title":"审计-会话乙","space":"phil","home":false} |
| mode-ask | 模式切换 → ask | PASS | chip="只读问答 ▾" |
| mode-plan | 模式切换 → plan | PASS | chip="计划模式 ▾" |
| mode-craft | 模式切换 → craft | PASS | chip="允许完全访问 ▾" |
| btn-terminal | 终端按钮 → 终端面板 | PASS | 打开=true 可关闭=true |
| btn-preview | 预览按钮存在（点击会打开系统文件对话框，无法自动化） | PASS | {"btn":true,"title":"预览文件 (docx/pdf/xlsx/pptx…)"} |
| btn-search-top | 顶栏搜索钮 → 搜索窗 | PASS | 搜索窗出现 |
| composer-context | @ 上下文按钮存在（点击打开系统文件对话框，无法自动化） | PASS | {"btn":true} |
| composer-slash | / 技能按钮 → 内联技能菜单 | PASS | {"items":3,"value":"/ "} |
| sub-mode | 模式 chip → 三选项菜单 | PASS | 菜单项=3 |
| composer-model | 模型 chip → 设置模型面板 | PASS | active panel=model |
| btn-send | 发送 → 草稿物化为会话 + mock 回复 | PASS | 回复="mock default reply" 会话 2→3 |

27/27 PASS。截图：本目录 00 张（每按钮 after 帧）。