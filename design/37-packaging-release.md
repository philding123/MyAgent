# 37 · 安装包与发布流水线

> 目标：一条流水线自动产出用户可直接安装的安装包（Windows / Linux / macOS），
> 发布前对**打包后的应用**做与源码同口径的验证，并与 F21 自动更新器的清单协议对接。

## WorkBuddy 观察

| 证据 | 结论 |
|---|---|
| `@genieworkbuddy-desktop-updater/installer.exe`（NSIS 静默包）、design/21 | wb 以 NSIS 安装器分发，更新 = 静默运行新安装器 |
| design/21 复现设计：清单 `{version, url, sha256, notes}`，exe 形态 `installer /S` | MyAgent 的 Windows 安装包必须是支持 `/S` 的 NSIS，清单字段对齐 |

## 设计

### 打包（electron-builder 26.15.3，配置 `electron-builder.yml`）

| 平台 | 目标 | 产物 |
|---|---|---|
| Windows x64 | NSIS（非一键、当前用户、可改目录、桌面+开始菜单快捷方式、卸载不删用户数据） | `MyAgent-Setup-<v>-x64.exe` |
| Linux x64 | AppImage + deb | `MyAgent-<v>-x86_64.AppImage`、`MyAgent-<v>-amd64.deb` |
| macOS（runner 原生架构，当前 arm64） | dmg（无签名证书 → `identity: null`） | `MyAgent-<v>-arm64.dmg` |

- `npm run dist` = `predist`（`npm run build` + `scripts/setup-electron-sqlite.mjs`）+ `electron-builder --publish never`。
- **原生模块**：`npmRebuild: false`。沿用既有双 ABI 设计——`node_modules/better-sqlite3` 保持 Node ABI 给测试，
  Electron 加载 `vendor/better-sqlite3-electron`（Electron ABI 预编译，由 predist 在各 runner 本机准备）；
  `@lydell/node-pty` 是 N-API 预编译包无需重编。打包冒烟断言 `store=sqlite`，静默降级 JSON 视为失败。
- **asar**：`app/**` 进 `app.asar`；`asarUnpack` 解出 `*.node`、node-pty、`skills/`、`market/`、`scripts/update/`。
  `app/shared/asar-path.js#unpacked()` 把 `app.asar` 路径映射到 `app.asar.unpacked`，用于会被复制（技能安装
  `fs.cpSync`）、被子进程执行（技能脚本、wscript 过渡窗）的目录；只读访问走 Electron asar shim 即可。
- **依赖瘦身**：渲染层库（mermaid/pdfjs/katex/marked/hljs/xterm/docx/pptx/xlsx…）已被 esbuild 打进
  `app/renderer/dist`，改为 devDependencies；页面直链的 CSS 与 KaTeX 字体由 `scripts/build.mjs` 复制到
  `dist/vendor/`。运行期 `dependencies` 只剩 `playwright-core`（F22 浏览器工具，此前是 devDependency，
  安装版会静默失去该能力）+ 可选的 node-pty / better-sqlite3。app.asar 162 MB → 35 MB，AppImage 197 → 130 MB。
- **图标**：`scripts/gen-app-icon.js` 用离屏 Electron 把内联 SVG 渲染为 `build/icon.png`（512）/
  `build/icon-1024.png`，electron-builder 由此派生 .ico/.icns。
- 冒烟夹具：打包版没有 `tests/`（且 asar 只读），`smokeFixture()` 在临时目录生成等价夹具。

### 发布元数据（`scripts/release-manifest.mjs`）

- `SHA256SUMS.txt`：本版本全部安装包（`sha256sum -c` 兼容）。
- `latest.json`：F21 清单 `{version, url, sha256, size, notes, releasedAt}`，指向 Windows NSIS 安装包；
  安装版 Windows 构建默认 `update.manifestUrl` =
  `https://github.com/philding123/MyAgent/releases/latest/download/latest.json`（`package.json#myagent`），
  用户自设的 `update.manifestUrl` 优先；开发态与非 Windows 构建无默认值（更新器只会应用 Windows 安装包）。

### 流水线（`.github/workflows/`）

| 工作流 | 触发 | 内容 |
|---|---|---|
| `ci.yml` | 每次 push / PR / 手动 | ubuntu + windows：`npm ci` → `npm run verify`（含 91 项按钮审计）→ 上传验收报告 |
| `release.yml` | 推 `v*.*.*` 标签；或手动（publish 勾选 → 草稿 Release） | windows/ubuntu/macos 三 runner：版本号取自标签 → `npm run dist` → `scripts/smoke-packaged.mjs`（对打包产物跑 E2E 冒烟）→ 上传安装包；publish 作业汇总 → `release-manifest.mjs` → `gh release create`（安装包 + SHA256SUMS + latest.json） |

## 验证

| 层 | 断言 |
|---|---|
| unit T21c | `release-manifest.mjs` 产物喂给真实 `Updater`：check 判定新版本 → download → sha256 verify → ready；同版本不算更新；只收本版本安装包 |
| 打包冒烟（本地 Linux，2026-10-21） | `dist-installer/linux-unpacked/myagent` 跑完整 E2E 冒烟 34/34，store=sqlite |
| 打包按钮审计（本地 Linux） | `button-audit.mjs --exec dist-installer/linux-unpacked/myagent` 91/91（终端经解包的 node-pty、技能从解包目录安装、MCP 子进程从 asar fork） |
| 非 root 启动 | 普通用户、无 `--no-sandbox` 命令行参数启动打包版：主窗/设置窗/搜索窗与 SQLite 正常（应用自身追加 no-sandbox，见 main/index.js） |
| CI | 三平台 runner 的构建与打包冒烟见 Actions 运行记录 |

## 已知限制

- 未代码签名：Windows SmartScreen / macOS Gatekeeper 首次运行需手动放行。有证书后在仓库 Secrets 配
  `CSC_LINK`/`CSC_KEY_PASSWORD`（Windows）或 Apple ID 公证变量，并去掉 `identity: null` / `CSC_IDENTITY_AUTO_DISCOVERY`。
- macOS 只出 runner 原生架构（vendored SQLite 是本机架构预编译）；x64 Mac 需另加 x64 runner。
- 仓库为私有时，Release 下载需要登录，`latest.json` 默认更新源对未授权用户不可达。
