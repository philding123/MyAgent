# 38 · 会话产物中心（F55 / T50）

状态:2026-10-24 实施完成。T50 单元/集成/审计全绿(见 acceptance-report.md);Windows 实机验证 5/6:资源管理器定位、剪贴板复制、原生确认弹窗(拒绝/批准)均真实通过,唯"默认应用真实启动"因本机 ShellExecute 文档关联对所有启动方失效记为环境归因(对照探针见 artifacts/artifact-center-live/report.md)。

## WorkBuddy 观察与差异

用户反馈 WorkBuddy 支持会话右侧可折叠产物预览及打开所在路径。已有 `20-mermaid-preview.md` 确认预览组件族，`10-agent-core.md` 和 task-parity 记录 present_files 交付；本轮未重新运行 WorkBuddy，不宣称右侧宿主像素等价。详细缺口与方案见 `artifacts/feature-gap-and-artifact-center-plan-2026-10-24.md`。

现有 F20 明确选择独立预览窗，F44 实时卡片在聊天中；F51 只保存普通工具结果，不保留 artifact。F55 将默认预览改为右侧面板，独立窗仍作为显式入口；此项修订此前“主窗不可内嵌预览”的设计。

## 复现设计

### 持久记录

成功 present_file / write_file 的工具结果携带 artifact；失败或拒绝不登记。daemon 规范化后将其保存到消息 tool_json 再广播，sqlite/json 共用现有 DAO，不新增表。字段为 `{schemaVersion:1,sessionId,toolCallId,path,name,sourceTool,createdAt,kind:'delivered'|'working',location:'local'|'remote'}`。会话内按路径去重，正式交付和工作文件显示区别；旧消息没有结构化字段则不猜测路径、不扫描磁盘。

`artifacts.list {sessionId}` 返回本会话规范记录数组；`artifacts.resolve {sessionId,path,operation}` 仅解析已登记且可读取的本地常规文件，校验原路径和 realpath、会话归属与沙箱规则。远端产物不可传给本机原生文件操作。删除会话不删除交付文件。

### 右侧宿主

主窗增加“产物”按钮、可折叠列表与预览，按会话隔离选中和折叠状态。聊天卡片与列表共享选择。正式交付实时到达默认展开预览，工作文件只登记；后台会话不抢焦点，切回时从持久消息恢复。用户主动折叠后，本轮后续交付不强制展开。切换文件/会话清理旧加载，过期异步返回不得覆盖当前内容。窄窗使用受限右侧覆盖面板，保留折叠按钮和聊天输入访问，不修改原有首页几何。

### 文件操作

既有 `rpc.window` 增加 `artifactAction {sessionId,path,operation:'reveal'|'open'|'copy'}`。main 经 daemon `artifacts.resolve` 取得受检目标，再调用 showItemInFolder / openPath / clipboard，不拼接 shell。只允许可信主窗发起，操作返回 `{ok:true,path}` 或 `{ok:false,error:{code,message}}`。独立预览入口先经 resolve 校验，现有手动选文件预览保留。

默认应用打开仅允许受支持文档、图片、文本白名单；HTML/SVG/脚本/快捷方式/可执行与不受信任网络路径拒绝。每次 open 弹原生确认，120 秒未批准视为拒绝，不记忆批准；模型无对应工具。路径复核后再执行，TOCTOU 无法完全消除，不作无竞态保证。原生测试接缝记录操作，不真实启动应用。

### 共享安全预览

`createPreviewController(container, invoke)` 提供 `load(path,{source})` 和 `destroy()`，供主窗和独立窗复用。保留 Office/图片/文本；Markdown 安全渲染，HTML 仅隔离禁脚本 iframe：sandbox 空权限、限制 CSP、清除活动内容和外部资源。禁止网络、导航、表单、下载和桥访问，不对 HTML 本地依赖开放任意 file:// 权限。源文件模式仅 textContent。

25MB、PDF 50 页、12 sheets、文本 200000 字符等上限保留但明确提示。未知类型返回失败态，不虚报成功；切换时销毁 PDF 实例和 Object URL。

## 验证方法

T50 单元／集成：成功与失败登记、规范化和去重、旧消息容错、双 DAO、后台交付、重启恢复、归属和 realpath/沙箱门控、安全扩展名、确认超时/拒绝与原生错误。保留 T08/T09/T10/T17/T20/T39/T43/T44 回归，T44 卡片改为成功事件后断言。

T50 UI 审计：真实 mock 交付两个文件、折叠/展开、历史恢复、会话隔离、路径复制/定位/默认应用接缝、独立窗、源码切换、安全 HTML/Markdown、截断提示、文件快速切换、窄窗与主题。新增控件必须按效果断言，不仅断言存在。

先 build 再 verify；实际 Windows 文件管理器与默认应用行为如果未实测，独立列为未验证，不以接缝代替。构建来源和本轮实施证据写 artifacts 报告。不变更交付目录、不自动扫描命令输出、不实现回滚或在线编辑。

实测记录(2026-10-24,`scripts/artifact-live-verify.mjs`,无测试接缝):文件管理器定位与路径复制在中文+空格路径下真实通过;默认应用打开的原生确认弹窗真实出现,拒绝不启动任何进程、批准后 shell.openPath 无错误;本机按文件关联启动文档(exe 直接启动正常)对所有调用方静默失效,系环境异常,已在报告中以同会话对照探针归因,修复系统默认应用关联后复跑该脚本应转绿。
