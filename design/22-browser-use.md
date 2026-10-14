# 22 · Browser-use 浏览器操控工具（F22）

> Phase-2。让引擎能驱动本机浏览器完成网页读取与操作（对齐 WorkBuddy browser-use）。

## WorkBuddy 观察（证据）

| 证据 | 路径 | 结论 |
|---|---|---|
| `node_modules/@genie/workbuddy-browser-use/package.json`（app.asar 内提取） | `"description": "Provider-neutral Browser protocol, input, DOM CUA, and visual primitives"`，exports `./protocol`、`./visual-layer` | WorkBuddy browser-use 是**中立动作协议层**：协议（动作集）、输入（点击/键入）、DOM CUA（可达性引用定位）、视觉原语（截图） |
| 90-deferred.md 复现路线 | `playwright + CDP 接入引擎工具` | 技术选型既定 |

## 复现设计

- 模块：`app/engine/tools/browser.js`，注册为单个引擎工具 `browser`
  （对齐"中立协议"——一个工具承载全部动作，而非每动作一个工具）。
- 动作协议（`args.action` 分发，全部返回 `{ok, summary, data?}`）：

  | action | 参数 | 返回 | 工具类别（模式策略） |
  |---|---|---|---|
  | `navigate` | `url` | 标题 + 最终 URL | read |
  | `content` | —（可选 `selector`） | 页面文本（≤20KB） | read |
  | `snapshot` | — | 可交互元素清单 `{ref, role, name}`（DOM CUA 引用层，≤80 项） | read |
  | `screenshot` | — | PNG base64（宽 ≤1280） | read |
  | `click` | `ref`（来自 snapshot） | 动作后快照摘要 | exec |
  | `fill` | `ref`, `value` | — | exec |
  | `press` | `key` | — | exec |
  | `scroll` | `dy` | — | exec |
  | `close` | — | — | read |

  `ref` 定位只接受本会话最近一次 `snapshot` 返回的引用（防注入任意 selector）。
- 后端：`playwright-core`（无浏览器下载）`launch({channel:'msedge'})`，回落 `'chrome'`；
  本机无 Edge/Chrome → 工具返回 `ok:false`（引擎报告，不崩溃）。headless 常开。
- 生命周期：每引擎会话一个 BrowserContext 单例；`close` 或进程退出时释放；
  超时统一 30s；导航等待 `domcontentloaded`。
- 策略整合：read 动作在 ask 模式可用（网页只读研究是 ask 的合法场景），
  exec 动作（click/fill/press/scroll）在 ask/plan 受 policy 限制——与 F07 双保险一致。

## 验证方法

| 层 | 断言 |
|---|---|
| unit T22a | 动作协议校验：未知 action、缺参数、伪造 ref 拒绝；read/exec 类别表正确 |
| int T22b | 真实系统 Edge headless + tests fixture 静态页：navigate→content 命中标记→snapshot 含按钮 ref→click 后 content 变化→screenshot 返回 PNG 魔数。无系统浏览器 → 测试标注 skip（报告 DEGRADED） |
| e2e T22（冒烟步 `browser-tool`） | daemon selfcheck `browser` 字段 = `{available, channel}`（探测结果，不强启浏览器） |
| 手工 | ask 模式让模型读一个本地 HTML 页并总结；craft 模式让它点击按钮 |

## 降级路径

- 无系统浏览器 / playwright-core 加载失败：`browser` 工具不注册进定义表，
  selfcheck `browser.available=false`（其余功能不受影响）。
