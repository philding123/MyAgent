# 32 · 启动画面 splash（F36）

> wb 观察：`main/index.js` `resolveSplashPreload()` → BrowserWindow
> `{width:800,height:500,resizable:false,frame:false,show:false,title:app.name}`；
> `main/splash/{splash.html,splash-preload.js,claw.png}` 为品牌加载页
> （样式注释：与 MigrationProgressView 视觉一致）。

## 复现设计

- `app/main/splash.js`：`createSplash()` 先于 daemon/tray/主窗创建：
  800×500、frameless、`resizable:false`、`show: !MYAGENT_SMOKE`，加载
  `app/renderer/splash.html`（MyAgent 品牌名 + CSS spinner，纯静态无 bundle）。
- 交接：主窗 `did-finish-load` → `closeSplash()`；15s 兜底超时强制关。
- 状态暴露：`splash.state()` → `{created, closed}` 供 smoke 断言。

## 验证方法

- e2e（T32，step `splash-handoff`）：smoke 结束时 `created===true` 且
  `closed===true`（时序：splash 先于主窗创建，主窗加载后销毁）。
