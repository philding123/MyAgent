# AGENTS.md — app/renderer 详细契约

## 1. 职责与定位

三个 BrowserWindow 页面，经 preload 暴露的 `window.myagent`（invoke/onEvent/windowAction/ping）与主进程通信。打包产物 `dist/*.js` 由 `scripts/build.mjs` 生成——**源码在 `src/`，产物不手改**。

## 2. 结构与组件

| 文件 | 职责 | 关键点 |
|---|---|---|
| `index.html` + `src/app.js` | 聊天主界面 | 会话 CRUD、模式切换、流式渲染、confirm 条、终端面板（xterm 懒加载）、`__renderTest` 冒烟钩子；wb 侧栏六项 + 「更多」弹出菜单、主区「专家·技能·连接器」页（`openHub`，F54，design/35）、会话相对时间 `relTime` |
| `settings.html` + `src/settings.js` | 设置中心 | 模型三件套（key 回车即加密入库后清空输入框）、技能启停/导入、记忆、selfcheck 展示、导出/清空 |
| `search.html` + `src/search.js` | 全局搜索 | Enter 触发 `search.query`，结果分 message/file 两类可跳转 |
| `style.css` | 主题与布局 | F60 token（design/44 §3）双主题：暖中性底、`--ink` 墨色主操作、`--shadow-sm/md/lg`、`--ring` 聚焦环、`pop-in/fade-up` 动效（reduced-motion 关闭）；`hidden` 类控制面板 |
| `src/ui-kit.js` | 共享 UI 原语 | `uiConfirm()` 页内确认对话框（替代 `window.confirm`，Enter 确认/Esc 取消） |
| `dist/`（构建产物） | 页面实际加载的 bundle | gitignore |

## 3. 铁律与不变式

- **XSS 防线**：所有模型输出经 `renderMarkdown`（marked+KaTeX+DOMPurify）；`escapeHtml` 用于工具摘要等插值处。
- **流式渲染状态机**：`streamingEl` 只在 token 事件间复用，done/error 后置空；tool 事件不进入流式块。
- **代码块装饰**：`decorateCode` 只在最终文本上跑（流式期间每 token 重渲染），hljs 由 textContent 生成节点，不破坏 DOMPurify 结果。
- **事件订阅统一入口**：`myagent.onEvent`（preload 聚合 rpc:event 广播）；topic 分发见 `app.js` 顶部。
- daemon 未就绪时 UI 必须可见失败状态（`daemon:status` → 状态点变红），不得白屏。

## 4. 开发与测试

- 改 `src/` 后：`npm run build` → `npm start` 人工验收；E2E 覆盖 bridge/render-sanitize（T17/T18）。
- 新增面板/设置项：先在 `design/` 立项，再动 `src/`；验收加 E2E 步骤（`app/main/index.js#runSmoke`）。
