# MyAgent — 个人 AI Agent 桌面工作台

对标腾讯 WorkBuddy 的个人使用复刻（无支付系统）。设计文档见 [`design/`](design/00-roadmap.md)，
逆向证据全部标注在其中。

## 快速开始

```bash
npm install          # electron 等依赖（可设 ELECTRON_MIRROR 加速）
npm run build        # esbuild 打包 renderer
npm start            # 启动应用
```

首次使用：Settings → Model 填 OpenAI 兼容 baseUrl / API Key / 模型名 → Test connection。
任选一个工作目录新建会话即可对话。三种模式：ask（只读）/ plan（写需批准）/ craft（全量）。

## 验收

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
