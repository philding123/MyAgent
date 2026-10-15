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
