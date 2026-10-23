# MyAgent — 个人 AI Agent 桌面工作台

对标腾讯 WorkBuddy 的个人使用复刻（无支付系统）。设计文档见 [`design/`](design/00-roadmap.md)，
逆向证据全部标注在其中。

## 安装（用户）

到 [Releases](https://github.com/philding123/MyAgent/releases) 下载对应系统的安装包：

| 系统 | 文件 | 说明 |
|---|---|---|
| Windows x64 | `MyAgent-Setup-<版本>-x64.exe` | NSIS 安装向导（当前用户安装，可改目录，建桌面/开始菜单快捷方式）。未签名：SmartScreen 提示时点「更多信息 → 仍要运行」 |
| Linux x64 | `MyAgent-<版本>-x86_64.AppImage` / `MyAgent-<版本>-amd64.deb` | AppImage：`chmod +x` 后直接运行；deb：`sudo apt install ./MyAgent-*.deb` |
| macOS (Apple Silicon) | `MyAgent-<版本>-arm64.dmg` | 未签名：首次打开在「应用程序」里右键 → 打开 |

下载后可用同一 Release 里的 `SHA256SUMS.txt` 校验。Windows 安装版在 设置 → 更新 → 检查更新 时
默认读取最新 Release 的 `latest.json`，有新版本即可下载并静默安装（F21）。

## 发布（维护者）

```bash
npm run dist                      # 当前系统的安装包 → dist-installer/（先自动 build + 准备 Electron-ABI SQLite）
node scripts/smoke-packaged.mjs   # 对打包后的应用跑 E2E 冒烟（--audit 再跑 91 项按钮审计）
```

推送 `vX.Y.Z` 标签即触发 `.github/workflows/release.yml`：Windows/Linux/macOS 三个 runner 各自构建安装包、
对打包产物跑冒烟，再发布 GitHub Release（安装包 + `SHA256SUMS.txt` + `latest.json`）。
也可在 Actions → Release → Run workflow 手动触发（只出构建产物；勾选 publish 则建草稿 Release）。
每次 push / PR 由 `.github/workflows/ci.yml` 在 Linux + Windows 上跑 `npm run verify`。详见
[design/37-packaging-release.md](design/37-packaging-release.md)。

```bash
git tag v0.2.0 && git push origin v0.2.0   # 版本号取自标签，无需先改 package.json
```

## 开发

```bash
npm install          # electron 等依赖（可设 ELECTRON_MIRROR 加速）
npm run build        # esbuild 打包 renderer
npm start            # 启动应用
```

首次使用：Settings → Model 填 OpenAI 兼容 baseUrl / API Key / 模型名 → Test connection。
任选一个工作目录新建会话即可对话。三种模式：ask（只读）/ plan（写需批准）/ craft（全量）。

### 验收

```bash
npm run verify       # 构建 + 单元 + 集成 + E2E 冒烟 → artifacts/acceptance-report.md
```

## 结构

```
design/    设计文档（路线图/架构/各功能域/测试计划）
app/
  main/      Electron 主进程（窗口/托盘/deeplink/守护进程客户端）
  daemon/    常驻业务进程（RPC/存储/技能/沙箱/搜索/终端/引擎托管）
  engine/    headless agent 引擎（JSON-Lines 协议，OpenAI 兼容 LLM）
  renderer/  UI（聊天/设置/全局搜索，marked+hljs+katex+xterm）
skills/    内置技能（SKILL.md 格式，与 WorkBuddy 一致）
tests/     unit / integration / e2e
scripts/   build / mock-llm / verify
```
