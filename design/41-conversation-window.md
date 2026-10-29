# 41 · 会话独立窗口（F37 / T53）

状态：2026-10-29 立项实施（路线图原「观察」项——个人并行会话需求已出现）；
验收以本轮 acceptance-report.md 为准。

## WorkBuddy 观察（app.asar 静态证据）

`main/window-apps.js`（asar 解包）内建窗口清单中的 `conversation` 应用：

```js
conversation: {
  rendererEntry: 'conversation',
  presentation: { preset: 'utility', customTitleBar: true,
    trafficLightPosition: {x:24,y:22},
    controls: ['close','minimize','maximize','fullscreen'],
    controlPosition: 'platform-default',
    width: 640, height: 800, minWidth: 480, minHeight: 600 },
  instancePolicy: 'single', maxInstances: 1,
  permissions: ['*'], storageScope: 'instance',
  validateParams: isMainWindowParams,   // 打开时不带参数
}
```

渲染层打开链路（asar 内 conversation 窗口引导 chunk）：

- `open({appId:'conversation'})` **单实例**：已存在则 `reused`，复用既有窗口；
- 目标会话**不通过启动参数传递**，打开/复用后经 `postMessage`（按 windowId 定向）
  把导航命令送进窗口：路由到 `/conversation/:id`，无目标则 `/`（home 态，
  `bodyClassName: 'conversation-home-window'`）；
- 打开前校验：目标会话必须存在（`conversations.get`，失败 NOT_FOUND）、
  请求带 `expiresAt`（过期 TIMEOUT）、账号指纹变更 CONFLICT、窗口中途关闭 NOT_FOUND；
- 从主窗打开时附带 `artifactPanel:'open'`（独立窗默认展开产物面板）。

结论：wb 的"任务窗口"是**一个可复用、可重定向的独立会话面**，不是 N 个并行窗口。

## 复现设计（MyAgent 约束下的等价面）

### 窗口（`app/main/windows.js`）

- `createConversation(sessionId)`：注册表键 `'conversation'` **单例**；640×800、
  minWidth/minHeight 480/600、frameless（同主窗 F38 口径）；
  载入 `index.html?windowKind=conversation&session=<id>`。
- **复用即重定向**（wb postMessage 语义）：窗口已存在 → focus + 仅向该窗
  `webContents.send('rpc:event', {topic:'app:pendingUrls', payload:[{action:'session', id}]})`
  ——复用既有 pendingUrls 管线，渲染层 `handlePendingUrls → openSession` 完成切换。
- 主题随全局 `setTheme` 广播（既有机制，无需新接线）。

### 主进程接线（`app/main/index.js`，窄 IPC 不变）

- `rpc.window` 新 action `openConversation`（`{id}`）：字符串化后调
  `windows.createConversation`；无 id → false（fail-safe，不开窗）。
- 新 action `win-self`（`{op:'minimize'|'maximize'|'close'}`）：用
  `BrowserWindow.fromWebContents(e.sender)` 作用于**调用方窗口**——独立窗的
  in-DOM 控件需要它；既有 `win-min/max/close` 仍固定主窗不动（不回归）。
- deeplink `myagent://session/<id>` 行为不变（仍落主窗——wb 同口径）。

### 渲染层 conversation 模式（`app/renderer`，单一代码路径）

- `?windowKind=conversation` → `body.classList.add('conversation-window')`：
  CSS 隐藏 `#band` 与 `#sidebar`，新增 `#conv-bar`（拖拽区 + 会话标题 +
  最小化/关闭按钮，走 `win-self`）；`#topbar`/`#composer`/产物面板/确认条全部保留。
- 启动：读 `session` query → `openSession(id)`；无 id 或会话不存在 →
  home 态（`newTask()` 草稿，首条消息物化会话——wb home 态等价）。
- 会话被删（`sessions:changed` 后列表无当前会话）：回落 `newTask()`（既有逻辑，
  草稿态在独立窗同样合法——这正是"并行开新任务"的入口）。
- 主窗打开入口：`#topbar` 新增 ⧉ 按钮（有当前会话时可用）→
  `windowAction('openConversation', {id: current.id})`。

### 多窗一致性（既有机制的自然结果，逐一核对）

| 风险 | 机制 |
|---|---|
| 两窗同看一会话，流式/工具卡重复渲染 | `rpc:event` 全窗广播 + 渲染层按 `current.id` 过滤——两窗各自正确渲染 |
| 确认门控双重应答 | `EngineHost.confirm` 首答即删 waiter，第二答 no-op；120s 超时默认拒绝不变 |
| 发送竞争 | daemon 串行喂同一 engine 进程；`runningSessions` 各窗自持（与主窗并开两任务同模型） |
| 主题/会话列表漂移 | `app:theme`/`sessions:changed` 广播既有 |

## 验证方法

| 层 | 断言 |
|---|---|
| e2e T53（smoke 步骤） | 主窗打开独立窗：body 带 conversation-window、sidebar/band 隐藏、会话标题正确；复用另一会话 → 窗口数不增、标题切换（重定向）；win-self minimize/close 生效；无 id 的 openConversation 不开窗 |
| 单元 T53 | `win-self` 只作用于 sender 窗口（fromWebContents 注入）；`openConversation` 参数校验 |
| 回归 | ui-shell/ui-main（T29 不回归：主窗布局不变）、多窗用例（T01 multi-window）、全量 verify |

## 降级 / 边界

- 单实例（wb 口径）：第二个会话不开新窗，而是重定向既有独立窗；要并排 N 个会话
  = 主窗 + 独立窗两路（wb 同样如此）。若日后需要 N 窗，改注册表键为
  `conversation:<id>` 即可，本轮不做。
- 独立窗产物面板沿用 F55 组件（wb `artifactPanel:'open'` 的等价物是面板可用，
  不强制默认展开——折叠状态记忆是 F55 既有行为）。
- 不做：fullscreen 控件（wb 有）、会话内路由前进/后退、独立窗内打开设置/搜索
  （主窗承担）。
