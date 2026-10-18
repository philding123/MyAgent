'use strict';
// Mock MCP stdio server (T46 fixture): newline-delimited JSON-RPC 2.0 —
// initialize / tools/list (one `echo` tool) / tools/call echoes its argument.
const readline = require('readline');

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-mcp', version: '1.0.0' },
    } });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{
      name: 'echo',
      description: 'echo the given text back',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }] } });
  } else if (msg.method === 'tools/call') {
    const text = (msg.params && msg.params.arguments && msg.params.arguments.text) || '';
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + text }] } });
  } else if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
