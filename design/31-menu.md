# 31 · 原生菜单最小面（F35）

> wb 观察：`main/menu-builder.js` 是 shim，暴露 `buildAndSetApplicationMenu`、
> `setMenuUserId`、`setIOAImWhitelistMenuVisible` —— 动态构建并设置应用菜单
> （含按用户/白名单可见性切换）。

## 复现设计

- `app/main/menu.js`：`buildMenu(handlers)` → `Menu.setApplicationMenu`。
  最小面（语义对齐 menu-builder 的「动态构建 + 事件委托」）：
  - **文件**：新建任务（`CommandOrControl+N`，→ 主窗 `rpc:event {topic:"menu:action",payload:{action:"new-session"}}`）、打开设置（`CommandOrControl+,`）、退出（role: quit）
  - **编辑**：role editMenu（跨平台剪贴板标准）
  - **视图**：role reload/forceReload/toggleDevTools/zoom 全套
  - **帮助**：打开自检（→ 设置窗 selfcheck 面板入口，最小化先复用 openSettings）
- 渲染层：`app.js` onEvent 处理 `menu:action` → `new-session` 调 `newSession()`。
- 每项用 `id` 标注，便于断言。

## 验证方法

- e2e（T31，step `menu`）：`Menu.getApplicationMenu()` 存在；`getMenuItemById`
  取 `new-session`（accelerator CmdOrCtrl+N）并以编程方式 `.click()` →
  daemon sessions.list 数量 +1（菜单事件真实闭环）。
