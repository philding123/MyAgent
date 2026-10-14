# 12 · 安全：文件沙箱 / 命令确认 / 凭证保护（F08 F09 F10）

## F08 文件沙箱规则

**WorkBuddy 观察**：`cli/vendor/sandbox/5.7.10/tsbx_rules.json`（原文结构）：
- `file_rules`：路径 glob + `action: read|write|delete = allow|deny`；
  **硬拒绝** `%USERPROFILE%\.ssh\**`、`%USERPROFILE%\.gnupg\**`（注释 "protect credentials"）；
  放行各类包管理缓存（npm/pip/cargo/go/...）与 Temp。
- `network_policy`：`"双引擎: tsbx 仅做 DNS hook 域名拦截; TCP 决策由 Rust LocalProxy 承担"`。
- `white_process`：浏览器进程白名单。
- 环境变量展开（`%USERPROFILE%`），`**` 递归通配。

**复现设计**（daemon/sandbox.js，纯 JS 规则引擎，规则文件格式**与 tsbx_rules.json 同构**）：
```json
{ "version": 1,
  "file_rules": [
    {"path": "%USERPROFILE%\\.ssh\\**",  "action": "read=deny|write=deny|delete=deny"},
    {"path": "<workspace>\\**",          "action": "read=allow|write=allow|delete=allow"},
    {"path": "**\\node_modules\\**",     "action": "write=deny|delete=deny"}
  ],
  "command_rules": { "deny_patterns": ["rm -rf", "rmdir /s", "format ", "del /f /s /q",
                                      "shutdown", "reg add", "schtasks /create", "curl .*\\|.*sh"],
                     "confirm_patterns": ["git push", "npm publish", ">"] } }
```
- 匹配：环境变量展开 → glob→RegExp（`**` 跨段，`*` 单段）→ 首条命中生效；无命中默认
  workspace 外 read=allow、write=deny（fail-safe）。
- 网络双引擎不做（个人用，DNS hook 越权；记录偏离，90-deferred §网络沙箱）。

**验证**：单元测试含 WorkBuddy 原规则用例的等价断言（.ssh 拒读/拒写/拒删；Temp 放行；
workspace 放行；通配边界）；T08。

## F09 命令确认门控

**WorkBuddy 观察**：交互模式 tool policy + `SecurityCenterPanel`/`SystemPermissionsPanel`、
`high-credit-approval-floating-panel`（其审批浮窗思路）。plan 模式语义见 10-agent-core.md。

**复现设计**：`run_command` 执行前过两级：
1. 沙箱规则（deny → 直接拒）；2. 确认策略（craft 下命中 `confirm_patterns` 或
模式为 plan 的写类操作 → 引擎发 `confirm_request{id,command}`，daemon 转推 UI，
用户批/拒后 `engine.confirm` 回流；超时 120s 默认拒绝）。批准结果不持久记住（每次都问，安全优先）。

**验证**：集成测试：危险命令 → 收到 confirm_request → 拒绝 → 工具结果 ok:false reason:denied；
批准路径执行成功。T09。

## F10 凭证保护与落盘加密

**WorkBuddy 观察**：`main/credential-protection.js` + `@genie/at-rest-crypto` +
`file-authentication-storage.js`（认证材料落盘加密）；沙箱对 `.ssh/.gnupg` 硬拒。

**复现设计**：设置中的 API Key 不落明文：
- Windows：优先 Electron `safeStorage`（DPAPI）；不可用时回退 `at-rest` 轻量加密
  （本机密钥文件 0600 + AES-256-GCM，密钥存 `%APPDATA%/myagent/keystore`，记录为弱于 DPAPI 的降级）。
- 沙箱规则保证引擎进程读不到凭证库目录（把 `%APPDATA%/myagent/keystore` 加入 file_rules deny）。

**验证**：单元测试：settings.set 存 API key 后，库里 value 不含明文子串；
E2E：引擎测试运行中尝试 read_file keystore 路径被拒。T10。
