# 43 · Computer Use（F59 / T55）

状态：2026-10-29 立项（P17），2026-10-30 四阶段一轮实施完成；验收以 acceptance-report 为准。

## 实施裁决（2026-10-30，随实现落定）

- **视觉回路不重编码**：纯 Node 引擎无图像编码器，首轮不做 PNG→JPEG/缩放重编码；护栏为
  **base64 ≤1.5MB/图 + ≤10 图/轮**（超限=错误即值），浏览器视口本就 1280 宽。
- **截屏双路**（实机发现：本机锁屏/无控制台会话下 CopyFromScreen 与 BitBlt 全屏捕获均
  「句柄无效」/全黑）：`screenshot` 无 ref=主屏捕获（该环境失败为诚实值）；
  **带 ref=PrintWindow(PW_RENDERFULLCONTENT) 截指定窗口**——渲染窗口自身 DWM 面，
  遮挡/锁屏下仍可用（pixel-capture-win32.ps1 已验证的同一路线）。
- **坐标纪律强于设计稿**：click/type/key 不仅要求坐标在窗口矩形内，且**必须 ref 化**
  （list_windows → w1..wN + 窗口相对坐标），与 browser 工具 ref 纪律同构，杜绝盲注桌面。
- **open_app 走命令规则**：gateTool 对 `computer open_app` 复用 sandbox checkCommand
  的 deny/confirm 模式（启动应用=执行命令）；文档类目标直接拒绝（本机关联启动失效
  LIVE-05b 且文档属 present_file/preview 职责）。
- **CUA 动作与 browser 既有自动化分层**：`computerUse.enable` 只门控坐标动作
  （browser click_at/type_at + computer 工具整体注册）；F22 既有 ref 自动化不受影响。
- 审计项 `computer-live` 双平台分流：win32 真实回路（列窗口+PrintWindow 截图进
  image_url）；无 PowerShell 环境断言诚实环境错误值。

## WorkBuddy 观察（app.asar 静态证据，2026-10-29）

wb 的 computer use 分两层，实现形态不同：

### OS 级「电脑操控」（主功能）

- **设置入口**：Settings → Agent 功能节，i18n `settings.agent.computerUse.*`（9 语言）——
  英文 "Desktop app control"，中文「安装成功后，WorkBuddy 可使用电脑操控能力，你可以
  随时停止。使用过程中可能会截屏或读取窗口内容，你可以在系统设置中撤销权限」；
  gated on `requireFlags:['localEnvironment…']`。
- **权限模型**：`setupPermission / applyPermission / permissionStatus`——需安装组件 +
  系统级授权（截屏/读窗口），可在系统设置撤销。
- **能力原语**：`computerUse.screenshot`（截屏）、`openApp`（打开应用）、`listWindows`（列窗口）。
- **任务形态**：`createTask / continueTask / readTask / deleteTask`——异步任务制；
  实现层 `ComputerUseSessionEnv`（按 sessionId 租约 `acquireBoth`，日志「取会话授权失败，本次不…」）。
- **模型**：目录含专用条目 `gemini-2.5-computer-use-preview-10-2025`（131k ctx / 64k out）
  + 独立 `computerUse.modelId` 配置。
- **后端**：first-party 工具键 `computer-use`，native runtime 注册表与 `browser-use` 并列
  （`installNativeRuntime` hosts 映射）；infra 服务代号 **`kinfra-cua`**（腾讯云端 CUA）。
- **审批门**：`computer-use:approval-resolved`，决策 **deny / once / always** 三档（可记忆 always）。

### 浏览器内 CUA

- workbuddy-browser-use 运行时能力清单 `['navigation','screenshot','cua','batch','dom_cua','visibility']`
  ——截图驱动 + DOM 驱动两套页面操控。
- **命名陷阱**：craft 提示词片段文件名 `browser-computer-use.md`，内容实为浏览器控制
  （workbuddy-browser-use Skill + 设置 > 智能体 > 浏览器控制指引），与 OS 级操控无关。
- 无 UI-TARS 痕迹（`uitars` grep 命中均为词表 "guitars"）。

## 复现裁决（个人使用约束下的偏离，逐条记录）

| wb 形态 | MyAgent 裁决 | 理由 |
|---|---|---|
| `kinfra-cua` 云端 CUA 服务驱动 | **本地回路**：截图工具 + 用户自备 LLM（OpenAI 兼容） | 腾讯闭云不可得；与 F57/F58「云能力→本地替代」同一模式 |
| 审批 deny/once/**always**（可记忆） | **不加 always**：exec 类 CUA 动作沿用现行模式策略（craft=allow、ask/plan=拒），确认门不记忆批准 | 不变式 #5 fail-closed 是红线；模式即粗粒度同意（与 browser exec 同口径） |
| 独立 `computerUse.modelId` | 首轮不做：沿用 `llm.model`；模型不支持图像时**错误即值**如实报告 | 单模型配置；专项模型键留观察项 |
| 异步任务系统（createTask…） | 不做：CUA 即会话内一轮任务，步数预算/续跑由 F45 既有机制兜底 | 复用面已够；wb 任务制的云端调度不适用 |
| 组件安装器 + 系统权限向导 | 设置开关 `computerUse.enable`（默认 **关**）+ 首次启用告警（会截取屏幕） | 无安装器；Windows 无 macOS 式辅助功能授权 |
| desktopCapturer 截屏 | **不可用**：daemon 是 fork 出的 Node 模式 Electron（`process.versions.electron` 为真但无 main API）→ 走 **PowerShell**（pixel-capture-win32.ps1 先例）；输入注入 PowerShell P/Invoke SendInput（EnumWindows 先例 artifact-center-live/enum-win.ps1） | 零新原生依赖；PowerShell 本机自动化路线已验证 |

**数据出境口径**：截图作为消息内容发给用户自配的 LLM 端点——与所有对话内容同通道；
本工具自身零遥测（不变式 #7 不变），设计文档如实告知用户此点。

## 复现设计

### 阶段 1 基础：引擎视觉回路 + 浏览器 CUA（P0）

- **引擎消息支持图像**：`state.history` 目前全部纯字符串 content（engine/index.js
  `{role:'user',content:text}` / tool 结果 JSON.stringify）。约定：工具结果可携带
  `{image: {mime, base64}}` → 该 tool 消息 content 组装为 OpenAI 多部件数组
  `[{type:'text'},{type:'image_url',image_url:{url:'data:...'}}]`；压缩/缩放护栏
  （JPEG ≤1280px 长边、单图 ≤300KB、每轮 ≤10 图，超限错误即值）。模型不支持图像 →
  该轮错误即值，不重试风暴。
- **browser 工具扩展**（沿用 F22 playwright-core 运行时）：新增动作
  `screenshot`（read 类）、`click_at {x,y}` / `type_at {x,y,text}`（exec 类，经
  kindOf 归 policy——ask/plan 拒）。对应 wb 浏览器 CUA 面（screenshot/cua）。

### 阶段 2：OS 原语（P0，新引擎工具 `computer`）

- 动作面（wb 原语对齐）：`screenshot`（read）/ `list_windows`（read）/
  `open_app {target}`（exec）/ `click {x,y}`、`type {text}`、`key {combo}`（exec，
  SendInput）。全部错误即值；坐标仅限已列窗口的客户区矩形内（防盲注桌面）。
- 实现：daemon 经 PowerShell 脚本执行（`MYAGENT_HOME` 外不落盘，脚本内嵌或
  scripts/ 内置）；每动作超时 10s；执行前后的窗口前置校验。
- 沙箱关系：computer 工具绕过文件沙箱是本质（它操控的是屏幕，不是文件系统）——
  因此**只认模式策略**（ask/plan 全拒 exec 类；craft 放行）+ 开关默认关，双保险。

### 阶段 3：门控与 UI（P1）

- `computerUse.enable`（默认 false）入 settings；首次启用弹原生告警（截屏内容将
  发往所配模型端点）；关闭时 computer/browser-CUA exec 动作返回 disabled 值。
- 运行中可见性：CUA 动作在工具卡上显示动作类型与目标坐标；abort 既有链路可中断。
- 按钮审计补项（browser CUA 一条真实回路；computer 原语 mock 断言）。

### 不做（本轮边界）

- 滚动/拖拽以外的手势合成、多显示器选择（首轮主屏）、`computerUse.modelId` 专项键、
  wb 任务系统、录制回放。

## 验证方法（T55）

| 层 | 断言 |
|---|---|
| unit | 图像多部件组装（含护栏：尺寸/数量/KB 上限、不支持图像错误即值）；computer/browser-CUA 动作 kindOf 映射（ask/plan 拒 exec）；坐标越界（窗口矩形外）拒绝；开关关闭返回 disabled；PowerShell 命令构造不落敏感路径 |
| int | daemon 计算机工具往返（注入假 PowerShell 执行器）；browser screenshot 动作返回 base64 并进引擎 history 图像部件（mock LLM 收到 image_url） |
| e2e/审计 | browser CUA 真实回路（本地 fixture 页：截图→按坐标点击→断言页面变化）；computer 原语实机抽查清单（手工：截屏/列窗口/记事本输入一轮） |

T55 预登记；实施轮再进 verify featureNames/e2eMap（现在注册零测试行会误伤门槛的
`subs+e2eSteps>0` 检查）。

## 阶段排期（P17，按序执行，每阶段独立可停）

| 阶段 | 优先级 | 交付 | 验收 |
|---|---|---|---|
| 0 证据与契约 | ✅ 立项完成 | 观察（本节）+ 偏离裁决表 + 工具/动作定名 | — |
| 1 视觉回路 + 浏览器 CUA | ✅ 2026-10-30 | vision.js 图像部件（1.5MB/10 图护栏）+ browser click_at/type_at | unit 全绿 |
| 2 OS 原语 | ✅ 2026-10-30 | `computer` 工具（PS list/shot/click/key/front/open + ref 坐标纪律） | unit 全绿 |
| 3 门控与 UI | ✅ 2026-10-30 | computerUse.enable 默认关 + 首启原生确认 + selfcheck + system 提示 | 集成 2/2 + 审计 cu-toggle/computer-live |
| 4 收口 | ✅ 2026-10-30 | 全量 verify ALL GREEN | acceptance-report |

## 降级 / 边界

- PowerShell 不可用/被策略禁用 → computer 工具整体返回环境错误值（浏览器 CUA 不受影响）。
- 模型无视觉能力 → 截图动作仍可用（存为产物供人看），回路降级为"截图交付"而非自动操控。
- 高 DPI 缩放坐标换算首轮按主屏 DPI 一档处理，多 DPI 环境记观察项。
