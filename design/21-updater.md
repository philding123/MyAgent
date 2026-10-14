# 21 · 自动更新器（F21）

> Phase-2。复刻 WorkBuddy 的静默更新 + 过渡窗体验，个人使用形态：清单驱动。

## WorkBuddy 观察（证据）

| 证据 | 路径 | 结论 |
|---|---|---|
| `resources/scripts/update-progress.ps1`（120 行头部注释） | WinForms 过渡窗，**4 条关闭策略**：①新主窗口可见即关；②安装器退出 + FadeMs(3s) 缓冲；③TimeoutSeconds(120s) 未见安装器兜底；④MaxInstallSeconds(600s) 绝对上限。注释明确：超时早关会让用户在 NSIS 仍覆写 app.asar 时手动启动（issue #135544）；窗口出现后等 DetectStartSeconds(3s) 才开始轮询，防"安装器未生成"竞态 | 过渡窗全部时序参数与关闭语义 |
| `resources/scripts/launch-update-progress.vbs` | VBS 中转的原因：`cmd /c start` 会闪 conhost 黑框；直接 detached PowerShell 会先退出；wscript 是 GUI 子系统，`WshShell.Run(cmd,0,False)` 隐藏启动且 PowerShell 在父进程退出后独立存活 | 无黑框启动过渡窗的机制 |
| `resources/scripts/` 与 `@genieworkbuddy-desktop-updater/installer.exe`（NSIS 静默包） | 更新 = 静默 NSIS 安装 + 过渡窗 + 新窗口可见才关 | 更新流程整体形态 |

## 复现设计

- 模块：`app/main/updater.js`（Electron main 内，不做独立进程——个人版无 NSIS 包管理负担）。
- 清单协议（自定，与 WorkBuddy 更新服务等价的最小面）：
  `update.manifestUrl`（settings，可空=禁用）指向 JSON：
  `{ "version": "0.2.0", "url": "https://…/myagent-0.2.0.zip", "sha256": "…", "notes": "…" }`。
- 流程：
  1. `check()`：fetch 清单 → 语义化版本比较（大于当前版本才有更新）；
  2. `download()`：下载到 `%TEMP%/myagent-update/`，广播 `app:update` 事件
     （topic 载荷 `{stage: check|download|verify|ready|error, progress}`）；
  3. `verify()`：sha256 校验，不匹配 → error 且删除残件；
  4. `apply()`（opt-in，默认仅提示）：
     - zip 包形态：解压到暂存目录 → 生成 `update.bat`（等待主进程退出 → 覆盖安装目录 → 重启）→ 过渡窗 → `app.quit()`；
     - exe 安装器形态：detached 启动安装器。
  5. 过渡窗：复刻证据机制——`scripts/update/update-transition.vbs` + `update-transition.ps1`
     （WinForms 无边框窗，"正在安装更新，应用将自动重启"；关闭策略 ①②④ 照搬，
     ③ 保留但语义改为"未见安装器"兜底；参数同名：TimeoutSeconds/MaxInstallSeconds/DetectStartSeconds/FadeMs）。
- 设置面板新增"检查更新"按钮 + 当前版本/最新版本显示。
- RPC：main 侧不走 daemon（更新是壳职责，与 WorkBuddy updater 独立于 app-server 一致），
  通过既有 `rpc.window` 扩展 action：`updateCheck`/`updateApply`/`updateState`。

## 验证方法

| 层 | 断言 |
|---|---|
| unit T21a | semver 比较（相等/小/大/脏版本）；sha256 不匹配 → error + 残件清理；清单畸形 → error 不抛 |
| int T21b | 本地 HTTP 静态服务当更新源：check→download→verify→ready 全链路，进度事件序列正确 |
| e2e T21（冒烟步 `updater-status`） | `rpc.window updateState` 返回 `{enabled, version, lastCheck}` 字段齐全（不外联） |
| 手工 | 自建文件服务器放新版本 zip，走一次完整 apply + 过渡窗重启 |

## 降级路径

- 无 manifestUrl → `enabled:false`，设置面板显示"未配置更新源"。
- 过渡窗脚本执行失败（策略禁 PowerShell 等）→ 直接退出重启，无过渡窗（非致命）。
