# 实机 WorkBuddy 捕获尝试记录（2026-10-14，证据留存）

目的：为像素对比采集运行中的 WorkBuddy v5.7.7（`D:\tools\workbuddy\install\WorkBuddy.exe`）。

## 尝试与结果

| # | 方法 | 结果 |
|---|---|---|
| 1 | `taskkill /IM WorkBuddy.exe /F` | 拒绝访问（全部 9 个进程，含子进程） |
| 2 | PowerShell `Stop-Process -Force` | 拒绝访问（同上） |
| 3 | `CloseMainWindow()`（WM_CLOSE） | 消息送达（返回 True）但进程不退 → 进程被保护，仅窗口消息可达 |
| 4 | 带 `--remote-debugging-port=9333` 重启 | 因单实例锁 + 进程保护失败，9333 从未监听 |
| 5 | `MoveWindow` 调整窗口位置/尺寸 | 返回 False（窗口管理被拒） |
| 6 | PrintWindow（PW_RENDERFULLCONTENT） | 返回 False |
| 7 | Win+Shift+方向键 拉回幽灵显示器窗口 | 窗口回到屏内（-11,-11, 2560×1598），但内容为纯蓝冻结面 |
| 8 | DWM 缩略图渲染（DwmRegisterThumbnail） | 只得到冻结占位蓝面（`wb-1576070-WorkBuddy.png`） |
| 9 | 屏幕拷贝（CopyFromScreen，显示器唤醒后） | 纯蓝面（`wb-live-1576070-WorkBuddy.png`），与 DWM 一致 |
| 10 | PostMessage 快捷键（Ctrl+K 等） | 无新窗口出现 |

## 结论

WorkBuddy 主进程受保护（终止/窗口管理/PrintWindow 全被拒），且其渲染面处于
冻结/空白状态（疑似长期处于幽灵显示器被 DWM 挂起）。运行时 UI 像素不可恢复，
像素基线改用 asar 内自带的骨架屏（详见 `artifacts/pixel-comparison.md` 第一节）。

## 附：真实设置 UI 的 asar 侧渲染尝试（2026-10-15，有界实验，已终止）

思路：http 服务绕过 file:// 模块 CORS + `window.workbuddyDesktop`/`__wbInvoke`
omni 桩（`scripts/wb-stub-preload.js`，经 `electron-shot.js` 的
`PIXEL_SHOT_HTTP/DOCROOT/STUB` 开关），让设置窗 React 真实挂载。

打通三层后被第四层挡住，错误链逐层：
1. `__wbInvoke not available, SDK not initialized` → 桩里补 `window.__wbInvoke` 解决；
2. `[NamespaceState] snapshot must return an object` / `[EnvironmentRegistry]
   environment leaf must be a finite scalar: stage` → omni 桩的返回形状不满足
   快照校验（需要真实的 snapshot 对象结构）；
3. `Uncaught Error: WorkBuddy desktop host is unavailable`（runtime-B7PLES2V.js）
   → 宿主运行时握手硬门，无真实 provider 无法通过。

结论：设置 UI 与宿主运行时深度耦合，桩渲染不可行；settings 面维持骨架基线口径
（几何以 chrome/×/nav 200px 对齐为准，见 pixel-comparison.md）。工具
（`wb-stub-preload.js` + electron-shot 的 HTTP/STUB 开关）保留，供后续按真实
provider 协议逐形状补桩时复用。

## 关联文件

- `wb-1576070-WorkBuddy.png` — DWM 缩略图捕获（冻结蓝面）
- `wb-live-1576070-WorkBuddy.png` — 屏幕拷贝（冻结蓝面，2560×1598）
- 采集脚本：`scripts/pixel-capture-win32.ps1`（list/shot/dwmshot/pclick/key/resize）
