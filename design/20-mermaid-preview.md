# 20 · Mermaid 图表渲染 与 Office 文档预览（F19 / F20）

> Phase-2。WorkBuddy 在聊天中渲染 mermaid 图表，并为产物提供 docx/pdf/pptx/sheet 预览。
> 本文档记录逆向证据、复现设计与验证方法。

## WorkBuddy 观察（证据）

| 证据 | 路径（逆向基线 `D:\tools\workbuddy\install\`） | 结论 |
|---|---|---|
| `renderer/assets/vendor-mermaid-CB24A5gm.js`（app.asar 内，2.8MB） | mermaid 完整 vendor bundle | 聊天渲染管线内嵌 mermaid（客户端渲染） |
| `renderer/assets/mermaid-plugin-component-BBc1trzM.js`（264B stub） | 仅做 `dist()` 初始化 + i18n 装配 | mermaid 为按需初始化的插件组件 |
| `renderer/assets/{docx,pdf,pptx,sheet}-preview-component-*.js` | 组件族统一 props：`{className, filename, file, theme, isLoading, environmentType}` | 四类预览共享一个契约：文件内容 + 主题 + 加载态 |
| docx 组件内含 `docx-preview` 字样（76KB 组件 + vendor 分离） | 使用开源库 **docx-preview** | docx 渲染 = docx-preview |
| pdf 组件含 `getDocument`、`GlobalWorkerOptions`（1.4MB） | 使用 **pdfjs-dist** | pdf 渲染 = pdf.js |
| sheet 组件含 `XLSX`、`univer`（3MB） | 使用 **SheetJS xlsx** 解析 + Univer 网格渲染 | sheet = xlsx 解析 + 表格渲染 |
| pptx 组件（1.2MB，独立 renderer） | pptx 专用渲染器 | pptx 独立渲染管线 |

## 复现设计

### F19 Mermaid（聊天内图表）

- 渲染管线挂点：`app/renderer/src/app.js` `renderMarkdown()` sanitize 之后，
  扫描 `pre code.language-mermaid`，逐块调用 mermaid 渲染为 SVG 替换代码块。
- 依赖：`mermaid`（npm，esbuild 打包进 bundle.js）。
- 安全：`mermaid.initialize({ startOnlyOnLoadSecurityLevel:'strict' })` 等价——
  使用 `securityLevel: 'strict'`，SVG 输出再过一次 DOMPurify；
  渲染失败（语法错误）保留原始代码块并附加错误角标，不吞异常。
- 时机：流式期间不渲染（token 抖动），`done` 事件与历史消息装载后渲染；
  提供 `window.__mermaidTest(sample)` 冒烟钩子。
- mermaid 代码块在 sanitize 时先按普通代码块保留，渲染替换发生在 sanitize 后，
  因此 XSS 面不变（T17 断言继续成立）。

### F20 文档预览（docx/pdf/pptx/sheet）

- 初版入口：主窗消息/工具产物走独立预览窗（保持聊天轻量）。
  2026-10-24 F55 修订：默认在右侧折叠面板内嵌预览，独立窗保留为可选入口；
  共享渲染器、安全边界与验证方法见 [38-artifact-center.md](38-artifact-center.md)。
  `rpc.window` 新增 action `openPreview`，参数 `{path}`。
- 文件内容获取：**窄 IPC 不变**——新增 daemon 方法 `files.readBinary {path}`
  （走 `sandbox.checkFile(path,'read')`，≤25MB，返回 `{mime, size, base64}`）。
- 页面：`app/renderer/preview.html` + `src/preview.js`（esbuild 第三入口）。
  按扩展名分发：
  - `.docx` → `docx-preview` `renderAsync` 进容器 div；
  - `.pdf` → `pdfjs-dist` `getDocument`（worker 文件由 build.mjs 拷入 dist，`workerSrc` 指向之）；
  - `.xlsx/.csv` → `xlsx`（SheetJS）`read` + `sheet_to_html` 逐表渲染（不引入 Univer，个人用足够，记 DEGRADED 不适用——功能等价）；
  - `.pptx` → `pptx-preview`（npm `init` + `render`）。
  - 其余扩展名：文本/图片直接展示，否则提示不支持。
- 依赖新增：`mermaid`、`docx-preview`、`pdfjs-dist`、`xlsx`、`pptx-preview`。

## 验证方法

| 层 | 断言 |
|---|---|
| unit T20a | mermaid 代码块提取计数；预览类型识别表（扩展名→库） |
| e2e T19（冒烟步 `mermaid-render`） | 主窗注入 flowchart 样本 → 容器出现 `svg`；XSS 样本仍不执行（复用 T17 断言） |
| e2e T20（冒烟步 `preview-window`） | `files.readBinary` 往返取 tests fixture 小文件；`openPreview` 打开第 4 窗；preview 页解码 base64 成功且按扩展名选中正确渲染器 |
| 手工 | 真实 docx/pdf/xlsx/pptx 各开一次预览窗，肉眼核对渲染质量 |

## 降级路径

- pdfjs worker 拷贝失败 → 主线程 fake worker（渲染慢但可用）。
- `pptx-preview` 渲染异常 → 提示"仅支持文本摘要"，不崩溃。
