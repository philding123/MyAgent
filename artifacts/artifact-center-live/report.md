# F55 产物中心 Windows 实机验证报告

- 时间: 2026-10-24T11:59:33.000Z;平台: win32;结果: 5/6 PASS
- 运行来源: dev checkout (electron .);分支 feat/artifact-center@86ce8dae76e1(未提交改动 38 项)
- MYAGENT_TEST_SEAMS 未设置 — 打开所在文件夹/默认应用打开/复制路径均为真实操作系统动作,PowerShell 从窗口/进程/剪贴板断言,非接缝记录。

| 用例 | 断言 | 结果 | 实测 |
|---|---|---|---|
| LIVE-01 | 交付成功自动登记,产物面板预览(中文+空格路径) | PASS | delivered=C:\Users\phil\AppData\Local\Temp\myagent-live-fx-gDtjAe\实机 交付目录\2026-10-24-11-59-09\实机 交付 报告.txt |
| LIVE-02 | 复制路径 → 真实剪贴板内容与产物路径完全一致 | PASS | clipboard matches (Chinese+spaces preserved) |
| LIVE-03 | 打开所在文件夹 → 真实资源管理器定位交付文件所在目录 | PASS | real Explorer opened C:\Users\phil\AppData\Local\Temp\myagent-live-fx-gDtjAe\实机 交付目录\2026-10-24-11-59-09 and was closed (1) |
| LIVE-04 | 默认应用打开·拒绝 → 原生确认弹窗出现,取消后不启动任何程序 | PASS | native dialog shown (screenshot), 取消 honored, nothing launched |
| LIVE-05 | 默认应用打开·批准 → 应用链路真实执行(原生弹窗批准→openPath 成功) | PASS | app chain complete; default-app window not observed — see LIVE-05b environment probe |
| LIVE-05b | 环境探测:本机基于文件关联的启动是否可用(失败=环境异常,非应用缺陷) | FAIL(环境归因) | no default-application window appeared; machine-level association launch is broken (independent control probes at the bottom of the report) |

产物路径: `C:\Users\phil\AppData\Local\Temp\myagent-live-fx-gDtjAe\实机 交付目录\2026-10-24-11-59-09\实机 交付 报告.txt`

## 本机关联启动对照探针(为 LIVE-05b 归因,报告生成时实测)

- direct exe launch (Start-Process notepad.exe <file>): **works**(窗口数 1)
- association launch (Start-Process <file.txt>): **silently no-op**(窗口数 0,exit code 0)

证据口径修订（2026-10-25）：留存的独立对照只有上述两项。直接启动 notepad.exe 可观察到窗口，而 Start-Process 文件.txt 未观察到匹配窗口，支持本机关联启动存在环境问题；不能据此证明所有启动方均失效或彻底排除其他因素。LIVE-04/05 证明原生确认与 openPath 无错误返回，默认应用最终可见效果仍未通过。此次只修订归因文字，未重跑历史实机操作，原始 results.json 保持不变。

截图(应用内为 Playwright 截取,弹窗与资源管理器为整屏截图):
- 01-delivered-panel.png
- 02-explorer-revealed.png
- 03-dialog-deny.png
- 04-dialog-approve.png
- fail-LIVE-05b.png

本报告由 scripts/artifact-live-verify.mjs 生成;单元/集成/接缝审计见 artifacts/acceptance-report.md 与 artifacts/button-audit/。