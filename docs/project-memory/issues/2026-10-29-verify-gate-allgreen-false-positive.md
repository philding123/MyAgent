# Issue 2026-10-29 · verify 验收门槛假 ALL GREEN（watchdog 截断的 smoke 蒙混过关）

- 状态：Resolved（2026-10-29，随 4805946 合入）
- 关联：scripts/verify.mjs；T16/T17/T19 行；F37 实施轮
- Related daily notes: [2026-10-29](../daily/2026-10-29.md)

## Symptoms

F37 会话窗实施轮的一次 `npm run verify` 打出 **ALL GREEN（exit 0）**，但验收报告里 T16（托盘/Deeplink）、T17（渲染管线）、T19（mermaid）三行为 **FAIL 且明细为空**；smoke-result.json 显示 ok=true、exitCode=0、39 步只跑了 24 步，且无 exception 步骤。

## Impact

验收门槛失守：截断的冒烟可带着缺失的 e2e 断言通过全局判定——违反 AGENTS.md「ALL GREEN 才算完成」的不变式；若未人工看报告行，一次假绿就流入了 main。

## Root Cause

1. runSmoke 的 180s watchdog 触发时走 `finishSmoke()`，把**已完成的步骤**写盘且 `ok` 仍为 true（缺失≠失败），exitCode=0；
2. verify.mjs 的 `allGreen` 只聚合四个阶段 exit code（unit/integration/e2e/audit），**从不看 T 行评估结果**——e2e-only 的 T 行（无单测兜底）步骤缺失时只体现为报告行 FAIL，不影响全局；
3. 触发源是 F37 新增 smoke 步骤里的真死锁：await 一段「会让调用窗自身关闭」的 executeJavaScript，webContents 销毁后 Promise 永不 resolve（Electron 不 reject），卡到 watchdog。

## Resolution

- 门槛：`allGreen` 增加对每个 T 行的聚合——`subs.every(ok) && e2eSteps.every(ok) && e2eSteps.length === e2eNames.length`（e2e 步骤**齐全性**首次纳入）；T49 审计项按 `.pass` 映射（与报告循环一致）。逐行打印 `ROW FAIL: <tid>` 便于定位。
- 死锁：关窗调用改 fire-and-forget + 轮询窗口注册表；坑位记入 app/main/AGENTS.md 已知坑。

## Validation

修复后同日三轮验证：① 加固当轮立即抓出 T50 fixture 缺 `#artifact-history` 按钮致 4 行 FAIL（构造函数 null.onclick 崩）；② 抓出 T54 忘注册 `featureNames`（报告缺行）；③ 安静机器全量 verify ALL GREEN（123/76/103，T01–T54 全 PASS）。

## Prevention

- 新增 T 编号必须注册 `verify.mjs` 的 `featureNames`（有 e2e 步进 `e2eMap`）——门槛按其聚合，漏注册=报告缺行。
- 改 index.html 产物面板按钮须同步 `tests/unit/T50-artifact-center.test.js` fixture DOM。
- 连带发现（同轮、非同因）：按钮审计紧跟 e2e-smoke 后可能负载偶发（PTY 回显超时/Playwright 点击稳定性 30s 超时）——安静机器复跑 ×3 即绿，属环境负载非代码缺陷，先复跑再归因。
