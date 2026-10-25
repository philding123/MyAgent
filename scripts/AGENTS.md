# AGENTS.md — scripts/

## 职责与定位

构建、验收与测试支撑脚本（ESM，`node scripts/*.mjs` 直跑）。

## 结构

| 脚本 | 职责 | 关键点 |
|---|---|---|
| `build.mjs` | esbuild 打包 renderer 三页面 → `app/renderer/dist/` | 改 renderer 后必须执行 |
| `verify.mjs` | 验收 runner：build → unit(TAP) → integration(TAP) → e2e 冒烟 → `artifacts/acceptance-report.md` + `verify-raw.json` | 用例名 `T\d+` 正则映射功能点；Electron 退出码以冒烟 JSON 的 exitCode 为准，跑完收割 myagent 路径下的 electron 进程 |
| `button-audit.mjs` | T49：真实应用 + mock LLM/MCP，主窗/设置窗/搜索窗全部控件按效果断言（91 项），verify 第 3b 步 | 结果 `artifacts/button-audit/{button-audit.md,results.json}`；失败截图同目录；Linux 自动 Xvfb+openbox；新增按钮必须在此加效果断言 |
| `artifact-live-verify.mjs` | F55/T50 Windows 实机验证：无测试接缝跑真实应用，真实资源管理器/原生确认弹窗/真实剪贴板，PowerShell 从窗口/进程/剪贴板断言 | 结果 `artifacts/artifact-center-live/{report.md,results.json}`；弹窗截图走 PrintWindow（CopyFromScreen 在模态前台会偶发失败）；本机按关联启动失效时 LIVE-05b 记环境归因（对照探针随报告生成）；`--exec` 可验打包产物 |
| `pixel-match-live.mjs` | wb 实机 CDP 截图（含 DPR）box 降采样到 CSS 像素后与 MyAgent 截图 pixelmatch | `--t` 阈值（0.02 能分辨 #f7f7f7 vs #fff 这类底色差，0.1 不能） |
| `smoke-packaged.mjs` | 对 `dist-installer/*-unpacked` 的打包应用跑 E2E 冒烟（断言 store=sqlite），`--audit` 追加按钮审计 | release.yml 每个平台构建后必跑 |
| `release-manifest.mjs` | `SHA256SUMS.txt` + F21 `latest.json`（Windows 安装包） | `--base-url` = Release 下载前缀；T21c 验证与 Updater 契约一致 |
| `gen-app-icon.js` | 离屏 Electron 渲染 SVG → `build/icon.png`/`icon-1024.png` | `xvfb-run -a electron scripts/gen-app-icon.js` |
| `vendor-claude-skills.mjs` | F53：从 anthropics/skills（锁 commit）生成 `market/claude-skills/`（index.json + Apache-2.0 技能 + tree_sha256；文档四件套仅列出） | `--repo <clone>` 复用本地克隆，`--ref <sha>` 锁版本；升级上游 = 重跑后跑 T47 |
| `vendor-agency-experts.mjs` | F56：从 msitarzewski/agency-agents（MIT，锁 commit）精选 26 位专家 persona 生成 `market/agency-experts/`（index.json + 逐字 md + sha256 + LICENSE/NOTICES） | `--repo <clone>`/`--ref <sha>`；升级上游 = 重跑后跑 T51；中文卡片名/简介是目录元数据，不回写上游 |
| `mock-llm.mjs` | OpenAI 兼容 mock server（scenario 队列：content/tool_calls/__error） | `startMockLlm()` 供集成测试 import；独立跑可当调试端点 |
| `real-llm-check.js` | 真实模型检查（CJS） | 读 `~/.codex/{config.toml,auth.json}`，经 daemon RPC 配置（Key 进 vault），R0–R2 七项断言，结果写 `artifacts/real-llm-result.json` |

## 铁律

1. verify.mjs 的 TAP 解析与 e2e 轮询逻辑勿轻易改——它承载验收门槛（99-test-plan.md）。
2. real-llm-check.js 是唯一允许触碰真实 `%APPDATA%/myagent` 配置的脚本。
3. Windows 注意：spawnSync 对 GUI 子系统（electron.exe）拿不到退出码 → 走 shell + 结果 JSON（见 verify.mjs §e2e 注释）。
4. Linux（无 DISPLAY）：verify 用 `xvfb-run -a` 包 Electron 冒烟，root 下追加 `--no-sandbox`；仅 Windows 才跑 PowerShell 收割进程。

## 命令

```bash
npm run build / npm run verify
node scripts/real-llm-check.js
node scripts/mock-llm.mjs
```
