# CLAUDE.md — MyAgent 根指南

@AGENTS.md

个人 AI Agent 桌面工作台（对标腾讯 WorkBuddy 的个人复刻，**无支付系统**）。
Electron 37 + Node.js：主进程窄 IPC → 常驻守护进程（RPC 总线/存储/沙箱/技能）→ headless 引擎子进程（工具循环）。

## 常用命令

```bash
npm install            # 安装依赖（Electron 下载慢可设 ELECTRON_MIRROR）
npm run build          # esbuild 打包 renderer（改渲染层后必须执行）
npm start              # 启动应用（正常 GUI 模式）
npm run verify         # 全量验收：build + 单测 + 集成 + E2E 冒烟 + 按钮审计 → artifacts/acceptance-report.md
npm run dist           # 当前系统安装包 → dist-installer/（electron-builder.yml；CI 见 .github/workflows）
node scripts/smoke-packaged.mjs  # 对打包产物跑 E2E 冒烟（--audit 加按钮审计）
npm run test:unit      # 仅单元测试（node --test tests/unit/*.test.js）
npm run test:int       # 仅集成测试
node scripts/real-llm-check.js   # 真实 LLM 检查（读 ~/.codex 配置，模型 gpt-6.1-sol）
node scripts/mock-llm.mjs        # 独立 mock LLM 服务（集成测试内部亦使用）
```

## 🚫 绝对禁止（YOU MUST NOT）

- **不得新增主进程业务 IPC 通道**：业务能力一律注册进 `app/daemon/index.js` 的 `methods` 表（窄 IPC 是架构铁律，见 design/11-daemon-rpc.md）。
- **不得放宽沙箱默认规则**（`app/daemon/sandbox.js` 的 `defaultRules`）：`~/.ssh`、`~/.gnupg`、`~/.aws`、myagent keystore 硬拒绝与"workspace 外默认只读"是 fail-safe 底线；改动必须同步更新 T08 测试。
- **不得明文存储 API Key**：只能经 `app/daemon/crypto.js`（CredentialVault）；T10 无明文断言不得删除。
- **不得绕过引擎侧模式策略**（`app/engine/policy.js`）：ask 模式拒绝写/执行是引擎强制，不允许只靠提示词约束。
- **不得删除双存储实现**（sqlite/json 同 DAO 接口）：T03 参数化测试覆盖两者。
- **不得实现支付/订阅功能**（范围裁决，design/90-deferred.md）。
- **不得在 Electron 主进程直接调用业务逻辑**（业务全部在 daemon；主进程只做窗口/托盘/deeplink/协议桥）。

## ⚠ 强约束（IMPORTANT）

- 测试命名必须以 `T\d+[a-z]?` 开头（verify.mjs 靠它映射功能点 F01–F18 出验收报告）。
- Electron/Windows 下 `app.exit`/`process.exit` 不可靠（进程树残留）：冒烟退出码走结果 JSON（`MYAGENT_SMOKE_OUT`），杀树用 `taskkill /T /F`。
- better-sqlite3 在 Electron 内不可加载（Node ABI prebuild），运行时自动降级 JSON store——两实现行为须一致，selfcheck 上报 store.mode。
- RPC 契约：请求 `{id, method, params}` → 响应 `{id, ok, result | error:{code,message}}`；事件 topic：`engine:{sessionId}`、`terminal:{id}:data`、`daemon:ready`、`daemon:status`。
- 功能点 SSOT 是 `design/00-roadmap.md`（F01–F18 状态表）；改功能先改设计文档。
- 技能格式与 WorkBuddy 一致：`SKILL.md` YAML frontmatter（name/description/allowed-tools/disable）。

## 子模块路由表

| 目录 | 职责 | 指南 |
|---|---|---|
| `app/main/` | Electron 主进程：窗口/托盘/deeplink/daemon 客户端 | [CLAUDE.md](app/main/CLAUDE.md) |
| `app/daemon/` | 常驻业务进程：RPC/存储/沙箱/技能/搜索/终端/引擎托管 | [CLAUDE.md](app/daemon/CLAUDE.md) |
| `app/engine/` | headless agent 引擎：LLM 工具循环/模式策略/内置工具 | [CLAUDE.md](app/engine/CLAUDE.md) |
| `app/renderer/` | UI：聊天/设置/全局搜索（marked+hljs+katex+xterm） | [CLAUDE.md](app/renderer/CLAUDE.md) |
| `app/preload/` | 渲染层唯一桥（contextBridge），安全边界 | [AGENTS.md](app/preload/AGENTS.md) |
| `design/` | 设计文档与逆向证据（00-roadmap 为总索引） | [AGENTS.md](design/AGENTS.md) |
| `docs/project-memory/` | 项目记忆：STATUS.md 现状快照 · todo.md 队列 · decisions/ · issues/ | [README.md](docs/project-memory/README.md) |
| `tests/` | unit / integration / e2e（T 编号映射功能点） | [AGENTS.md](tests/AGENTS.md) |
| `scripts/` | build / verify / mock-llm / real-llm-check | [AGENTS.md](scripts/AGENTS.md) |
| `skills/` | 内置技能（SKILL.md 格式） | [AGENTS.md](skills/AGENTS.md) |
| `artifacts/` | 验收报告与测试产物（verify.mjs 生成） | — |
| `runtime-data/` | 运行期用户数据（gitignore；真实数据在 `%APPDATA%/myagent`） | — |
