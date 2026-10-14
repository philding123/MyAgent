# 24 · 系统分享目标（sparse MSIX）（F24）

> Phase-3。让 Windows"右键 → 共享"能把文件发给 MyAgent。个人使用：注册脚本 + 自签证书。

## WorkBuddy 观察（证据）

| 证据 | 路径（逆向基线 `D:\tools\workbuddy\install\`） | 结论 |
|---|---|---|
| `WorkBuddyShareTarget.msix` + `share-target/WorkBuddyShareTarget.exe` | sparse package：MSIX 只登记身份+Share 扩展，可执行文件留在安装目录原位 | sparse MSIX 方案 |
| `share-target/scripts/register.ps1`（全文可读） | 环境变量传路径（`WB_SHT_INSTDIR`/`WB_SHT_LOG`）；日志双写（主日志 + %TEMP% 备份）；**AppXSvc 挂起防护**：Add-/Remove-AppxPackage 包在后台 Job 里，60s 超时放弃（exit 4），读操作（Get-AppxPackage）前台执行；退出码 0=成功 1=异常 2=缺工件 3=注册后不可见 4=超时；P3 自愈：应用下次启动重试注册 | 注册脚本全部工程细节 |
| `share-target/scripts/unregister.ps1` | best-effort：包残留仅是孤儿记录，可手动 Remove-AppxPackage | 注销语义 |
| 90-deferred.md | AppLocker 规避：脚本放 `$INSTDIR` 而非 %TEMP%；P3 自愈引用 `main/integrations/win-share-target/registrar.ts` | 部署位置选择 |

## 复现设计

- 目录：`myagent/share-target/`
  - `AppxManifest.xml`：sparse 包身份 `MyAgentShare`（Personal 用自签证书），
    `uap:Extension Category="windows.shareTarget"` 支持文件类型
    （文本/图片/office 常见扩展名清单），`Executable="share-target/MyAgentShareTarget.cmd"`。
  - `MyAgentShareTarget.cmd`：把收到的 `%1`（文件路径）转发给主程序
    `myagent.exe --share <path>` 后退出（免常驻 helper 进程——对 WorkBuddy
    独立 exe 的个人化简化，功能等价：文件进应用）。
  - `register.ps1` / `unregister.ps1`：按证据结构改写——
    `MYAGENT_SHT_INSTDIR`/`MYAGENT_SHT_LOG` 环境变量、双写日志、
    Appx Job 60s 超时、同退出码语义；额外：无证书时 `New-SelfSignedCertificate`
    生成并装入 TrustedPeople（sparse 包 Add-AppxPackage 需要受信签名）。
- 主程序接收：`app/main/index.js` 启动参数解析 `--share <path>` →
  daemon `sessions.create {title:'Shared: <name>'}` +
  `sessions.appendMessage {role:'user', content:'[shared file] <path>'}` → 开主窗。
  P3 自愈：启动时若 `share.wantRegistered` 设置为 true 且 `Get-AppxPackage` 查不到包
  → 静默后台重跑 register.ps1（仅记录日志，失败不打扰）。

## 验证方法

| 层 | 断言 |
|---|---|
| unit T24a | AppxManifest.xml 用 XML 解析器验证结构（Identity/ShareTarget/文件类型存在）；两个 ps1 用 PowerShell `Parser::ParseFile` 语法校验 + 必需函数/参数存在 |
| e2e T24（冒烟步 `share-argv`） | 以 `--share tests/fixtures/share-sample.txt` 启动一次冒烟 → 断言产生含该文件引用的会话消息（冒烟内复用既有 daemon RPC 校验） |
| 手工 | 运行 register.ps1（管理员）；资源管理器右键文件 → 共享 → MyAgent → 主窗出现新会话 |

## 降级路径

- 未注册（未跑脚本）：功能纯增量缺失，主程序不受影响。
- Add-AppxPackage 被策略阻止：脚本 exit 1/4，自愈会在下次启动重试；文档写明手动路径。
