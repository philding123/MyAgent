# 30 · MCP 服务面（F34）

> wb 观察：`main/app-server-mcp-apps-host*.js` 在 app-server 内托管 MCP 应用，
> 协议面出现 `tools/call`（×3）与 `resources/read`（×3），MCP = Model Context
> Protocol（JSON-RPC 2.0 over stdio）。wb 把自身能力作为 MCP 服务暴露给宿主/客户端。
>
> MyAgent 目标：把会话/技能/搜索能力暴露为标准 MCP server（stdio），供任意
> MCP 客户端（Claude Desktop、编辑器等）接入。

## 复现设计

- **协议核** `app/daemon/mcp.js`（纯函数，无 I/O，便于测试）：
  `createMcpCore({ name, version, tools, callTool, resources, readResource })`
  → `handle(msg)`：
  - `initialize` → `{protocolVersion:"2024-11-05", capabilities:{tools:{},resources:{}}, serverInfo:{name,version}}`
  - `notifications/initialized` → `null`（通知不回包）
  - `tools/list` → `{tools:[{name,description,inputSchema}]}`（来自 tools 注册表）
  - `tools/call` → `{content:[{type:"text",text}], isError?}`（委托 callTool）
  - `resources/list` / `resources/read` → 会话资源（`myagent://sessions/{id}`）
  - `ping` → `{}`
  - 未知方法 → JSON-RPC error `-32601`；missing params 内部错误 → `-32602`
- **stdio 传输** `app/daemon/mcp-server-child.js`：独立子进程，stdin 按行读
  JSON-RPC，stdout 按行写响应；自带 store/search/skills 实例（与 daemon 同
  MYAGENT_HOME），不依赖 daemon 进程存活。
- **daemon 方法**：`mcp.start`（spawn 子进程并持有句柄）/ `mcp.stop` /
  `mcp.status`（{running, pid}）。
- **暴露的工具**（最小面）：`sessions_list`、`session_get`、`search_query`、
  `skills_list`；资源：`myagent://sessions/{id}`。
- selfcheck 能力矩阵增加 `mcp` 字段。

## 验证方法

- T30（integration，`tests/integration/mcp.test.js`）：initialize 握手字段
  → tools/list 含 4 工具 → tools/call `search_query` 命中 → resources/read
  回读会话 → 未知方法 -32601 → 通知返回 null。
- e2e：`mcp-status`（smoke 经 `mcp.start` 后 running=true、`mcp.stop` 后 false）。

## F52 连接器（MCP 客户端，2026-10-18）

**WorkBuddy 观察**：侧栏「专家·技能·连接器」的连接器 = MCP 集成（证据：`~/.workbuddy/
mcp-tool-list.json`，工具名 `workbuddy_cloudservice_db_*` 形态；`~/.workbuddy/connectors/`
有 registry）。MyAgent 此前只有 MCP 服务端（F34），没有客户端——REA 这类 MCP 工具接不进来。

**复现设计**（daemon/mcp-client.js）：
- 每个连接器 = 一个 stdio MCP 服务器子进程（initialize 握手 → tools/list），存于
  store 设置 `connectors`（id/name/command/args/env/enabled），RPC
  `connectors.list/add/remove/toggle/status`，selfcheck 增 `connectors` 字段。
- 工具注入：buildInit 带 `connectorTools`，引擎以 `mcp_<连接器>_<工具>` 注册
  （工具名净化为 [a-z0-9_]），**kind='exec'**（fail-safe：ask 拒绝、plan 确认），
  调用走既有 daemon_tool 桥（与 F25 market 同通道，窄 IPC 不变）。
- 设置页「连接器」面板 + 侧栏导航项（对齐 wb 入口语义）。

**验证**：T46（mock MCP stdio server：add→connected→tools 列出/重名拒/toggle；
引擎全链路 tools/call 往返，结果回喂 LLM）。
