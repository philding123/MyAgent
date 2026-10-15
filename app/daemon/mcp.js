'use strict';
// MCP (Model Context Protocol) server core (F34, design/30-mcp.md). Pure
// JSON-RPC 2.0 protocol: no I/O — a transport feeds handle() one parsed
// message at a time. wb counterpart: main/app-server-mcp-apps-host*.js
// (tools/call, resources/read inside its app-server).

const PROTOCOL_VERSION = '2024-11-05';

function err(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function createMcpCore({ name, version, tools = [], callTool, resources, readResource }) {
  const serverInfo = { name, version };

  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
      return err(msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid Request');
    }
    const id = msg.id;
    const isNotification = id === undefined || id === null;
    const respond = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });
    const fail = (code, message) => (isNotification ? null : err(id, code, message));
    try {
      switch (msg.method) {
        case 'initialize':
          return respond({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
            serverInfo,
          });
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null; // notifications get no response
        case 'ping':
          return respond({});
        case 'tools/list':
          return respond({
            tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          });
        case 'tools/call': {
          const toolName = msg.params && msg.params.name;
          if (!tools.some((t) => t.name === toolName)) return fail(-32602, 'Unknown tool: ' + toolName);
          const out = await callTool(toolName, (msg.params && msg.params.arguments) || {});
          return respond({
            content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }],
          });
        }
        case 'resources/list':
          return respond({ resources: await resources() });
        case 'resources/read': {
          const uri = msg.params && msg.params.uri;
          if (!uri) return fail(-32602, 'params.uri is required');
          const out = await readResource(uri);
          if (out === undefined || out === null) return fail(-32602, 'Unknown resource: ' + uri);
          return respond({
            contents: [{ uri, mimeType: 'application/json', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }],
          });
        }
        default:
          return fail(-32601, 'Method not found: ' + msg.method);
      }
    } catch (e) {
      return fail(-32603, 'Internal error: ' + e.message);
    }
  }

  return { handle, serverInfo, protocolVersion: PROTOCOL_VERSION };
}

module.exports = { createMcpCore, PROTOCOL_VERSION };
