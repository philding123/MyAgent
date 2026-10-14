# CLAUDE.md — app/renderer

@AGENTS.md

UI 层：聊天主窗 / 设置窗 / 全局搜索窗。esbuild 打包（改 `src/` 后必须 `npm run build`，否则页面仍加载 dist 旧包）。

## 常用命令

```bash
npm run build       # esbuild → dist/{bundle,settings,search}.js（改 src 后必须）
npm start           # 应用启动后人工查看
```

## 🚫 绝对禁止

- 不得绕过 preload 桥直接访问 Node/Electron API（contextIsolation 开启，`window.myagent` 是唯一入口）。
- 不得移除 DOMPurify 清洗（`renderMarkdown`）——XSS 断言在 E2E（render-sanitize）与 CSP 双保险。
- 不得在页面内嵌外部 CDN 资源（CSP `default-src 'self'`，依赖一律走 esbuild 打包）。

## ⚠ 强约束

- 渲染管线顺序：marked(GFM) → KaTeX（$$块$/行内$）→ DOMPurify（FORBID script/style/iframe）。
- 引擎事件 → UI 的映射在 `src/app.js#handleEngineEvent`：status/token 追加流式块、tool_call/tool_result 渲染工具卡片、confirm_request 显示批准条。
- 模式切换调用 `sessions.setMode`（daemon 会停引擎，下次发送重启并带新模式）。
- 主题切换必须走 `myagent.windowAction('setTheme')`（主进程广播 `appearance` 实现跨窗同步）。

## 子文件路由

| 文件 | 职责 |
|---|---|
| `index.html` + `src/app.js` | 聊天主界面（会话侧栏/消息流/确认条/终端面板） |
| `settings.html` + `src/settings.js` | 模型/外观/引擎/技能/记忆/自检/数据管理 |
| `search.html` + `src/search.js` | 全局搜索（消息+文件双域） |
| `style.css` | 主题变量（data-theme=dark/light） |
