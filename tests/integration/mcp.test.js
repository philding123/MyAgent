'use strict';
// T30 (F34, design/30-mcp.md): MCP protocol core + adapters against a seeded
// store. Covers the wb app-server-mcp-apps-host surface (tools/call,
// resources/read) with the standard MCP JSON-RPC handshake.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMcpCore } = require('../../app/daemon/mcp');
const { createAdapters } = require('../../app/daemon/mcp-server-child');

function seed() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-t30-'));
  fs.mkdirSync(path.join(home, 'workspace'), { recursive: true });
  const { store } = require('../../app/daemon/store').openStore(path.join(home, 'data'));
  const s = store.createSession({ title: 'mcp fixture' });
  store.appendMessage({ session_id: s.id, role: 'user', content: 'hello mcp world' });
  return { home, store, sessionId: s.id };
}

test('T30 initialize handshake returns protocol version + server info', async () => {
  const f = seed();
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(f.home) });
  const out = await core.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(out.jsonrpc, '2.0');
  assert.equal(out.result.protocolVersion, '2024-11-05');
  assert.equal(out.result.serverInfo.name, 'myagent');
  assert.deepEqual(out.result.capabilities.tools, { listChanged: false });
});

test('T30 notifications return null (no response frame)', async () => {
  const f = seed();
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(f.home) });
  assert.equal(await core.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('T30 tools/list exposes the four minimal tools', async () => {
  const f = seed();
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(f.home) });
  const out = await core.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(out.result.tools.map((t) => t.name).sort(),
    ['search_query', 'session_get', 'sessions_list', 'skills_list']);
});

test('T30 tools/call sessions_list returns the seeded session', async () => {
  const f = seed();
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(f.home) });
  const out = await core.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sessions_list', arguments: {} } });
  assert.ok(out.result.content[0].text.includes('mcp fixture'));
});

test('T30 tools/call search_query finds the seeded message', async () => {
  const f = seed();
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(f.home) });
  const out = await core.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_query', arguments: { q: 'hello mcp' } } });
  assert.ok(out.result.content[0].text.length > 0);
  assert.equal(out.result.isError, undefined);
});

test('T30 tools/call with unknown tool fails -32602', async () => {
  const f = seed();
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(f.home) });
  const out = await core.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } });
  assert.equal(out.error.code, -32602);
});

test('T30 resources/read round-trips the seeded session', async () => {
  const f = seed();
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(f.home) });
  const list = await core.handle({ jsonrpc: '2.0', id: 6, method: 'resources/list' });
  assert.equal(list.result.resources.length, 1);
  const read = await core.handle({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: list.result.resources[0].uri } });
  const parsed = JSON.parse(read.result.contents[0].text);
  assert.equal(parsed.title, 'mcp fixture');
});

test('T30 unknown method fails -32601; invalid request fails -32600', async () => {
  const f = seed();
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(f.home) });
  assert.equal((await core.handle({ jsonrpc: '2.0', id: 8, method: 'x/y' })).error.code, -32601);
  assert.equal((await core.handle({ jsonrpc: '2.0', id: 9 })).error.code, -32600);
});
