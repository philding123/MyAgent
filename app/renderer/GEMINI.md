# GEMINI.md — app/renderer 架构定位

WorkBuddy renderer 的极简对应物：三页面（chat/settings/search）+ 统一渲染管线。刻意不引入框架——vanilla JS + esbuild，保持可审计性。

## 运行

- 构建：`npm run build`（必须，页面加载 dist/）。
- 启动：`npm start`。CSP `default-src 'self'`，无外链资源。

## 红线

1. `window.myagent` 是唯一宿主入口（preload 桥）。
2. 模型输出必须过 DOMPurify；禁外链脚本/样式。
3. dist/ 是产物——改 src/ 后必须重新 build。

## 模块索引

[src/app.js](src/app.js)（聊天+事件分发）· [src/settings.js](src/settings.js)（设置）· [src/search.js](src/search.js)（搜索）· [style.css](style.css)（主题）
