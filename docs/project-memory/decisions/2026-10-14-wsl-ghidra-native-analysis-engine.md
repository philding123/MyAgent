# ADR 2026-10-14 · 原生逆向分析引擎选型：WSL2 Ubuntu-24.04 + Ghidra 12.1.4（经 REA）

- 状态：Accepted（2026-10-14）

## Decision

采用 **WSL2 独立发行版 Ubuntu-24.04 + Ghidra 12.1.4（经 REA ghidra provider）** 作为本工作流的原生二进制逆向引擎。

| 组件 | 状态 |
|---|---|
| WSL 发行版 | Ubuntu-24.04（`wsl --import` 导入，免管理员；原 CentOS7 未动），默认用户 `phil` |
| 分析引擎 | Ghidra 12.1.4 @ `/opt/ghidra_12.1.4_PUBLIC`，headless |
| 运行时 | OpenJDK 21.0.12（`/usr/lib/jvm/java-21-openjdk-amd64`）+ Node v22.23.3 + rea-agents 6.4.0 |
| ZCode 注册 | `wsl.exe -d Ubuntu-24.04 -e bash -lc "rea mcp"`，握手验证通过 |
| 端到端验证 | 实测分析 `/usr/bin/ls`：524 functions、33 segments、492 strings、完整 section/符号表 |

## Context

WorkBuddy 逆向需要原生二进制分析能力（后续目标：`cli/vendor/sandbox/*/sandbox-center.exe`、`tsbx.dll`、`turing-sdk/TuringShieldSDK.dll` 等原生模块）。约束：Windows 版 Ghidra 的 REA provider（P0 只读适配）尚未发布；本机无管理员权限，不能 `wsl --install` 在线装发行版；机器上原有 CentOS7 WSL 发行版过旧（无法跑 Node 22），需保留不动。

## Options Considered

1. **Windows 本机 Ghidra + REA** —— P0 适配未发布，放弃。
2. **升级复用现有 CentOS7 发行版** —— 系统库过旧，Node 22 无法运行，且不宜动原有环境，放弃。
3. **Hopper** —— 商业软件未安装，放弃。
4. **新导入 WSL2 Ubuntu-24.04（选定）** —— `wsl --import` 免管理员、与原发行版隔离、Ghidra/Node/JDK 全新可控。

## Rationale

`rea doctor --provider ghidra` 全项 healthy；REA `binary_session` 复核（2026-10-14）：provider `available`，8 项检查（configuration/platform/architecture/installation/version/headless/native_decompiler/java）全 ok，原生反编译器（elf x86_64）与平台匹配；/usr/bin/ls 端到端实测通过。工作区级持久记忆（`rea-repo-cloned`）同步记录此引擎状态。

搭建 gotchas（复现必读）：① GitHub release 下载必须 `curl -L`（302 跳 CDN，漏掉静默得 0 字节）；② 本网络到 github.com 抖动、gh-proxy.com 限速——并行分块下载 + 分片续传可用（N=16）；③ Git Bash 会改写传给 wsl.exe 的 `/mnt/...` 路径，加 `MSYS_NO_PATHCONV=1`；④ npm 包名 `rea-agents`，二进制名是 `rea`；⑤ provider 环境经 `/etc/profile.d/rea-tools.sh` 导出（仅登录 shell），注册命令须 `bash -lc`。搭建脚本留存：`D:\Proj\ai_workspace\_wsl-setup\`。

## Consequences

- **解锁**：WorkBuddy 原生模块（sandbox/tsbx/turing-sdk）逆向不再受平台限制，直接走 REA 原生工具链（`open_binary` → `analyze_function`/伪码/xrefs）。
- 限制：Ghidra 会话为临时工程（`close_binary` 即弃，注释/改名等元数据编辑不落盘）；Hopper/IDA 路线未配置；macOS 专属能力（Mach-O 生态）本机不可用。

## Verification

- `rea doctor --provider ghidra` 全项 healthy（多次运行一致）。
- REA `binary_session`（2026-10-14）：8 项检查全 ok。
- 端到端：/usr/bin/ls → 524 functions、33 segments、492 strings、完整 section/符号表。
- ZCode 注册握手通过（`wsl.exe -d Ubuntu-24.04 -e bash -lc "rea mcp"`）。
