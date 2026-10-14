# AGENTS.md — app/preload（安全边界）

## 职责与定位

渲染层与主进程之间唯一的桥。`contextBridge.exposeInMainWorld('myagent', ...)`，contextIsolation 开启、nodeIntegration 关闭。

## 结构

- `invoke(method, params)` → ipcRenderer.invoke('rpc')——业务 RPC 唯一通道。
- `windowAction(action, extra)` → 'rpc.window'（开窗/主题/目录选择）。
- `onEvent(fn)` → 聚合主进程 `rpc:event` 广播（返回退订函数）。
- `ping()` / `platform` — 冒烟断言与环境探测。

## 铁律

1. **不得暴露 ipcRenderer 原始对象或任意通道名参数**——白名单式 API，杜绝渲染层任意 IPC。
2. 新增桥方法 = 同步评估主进程 handle 白名单与 design/ 契约文档。
3. 本目录禁止 require 任何业务模块。

## 测试

E2E 冒烟 `preload-bridge` 步骤断言 `window.myagent.ping() === 'pong'`（app/main/index.js#runSmoke）。
