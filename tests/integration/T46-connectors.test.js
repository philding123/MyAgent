'use strict';
// T46: connectors (F52, wb「连接器」= MCP client) — real daemon + real mock MCP
// stdio server: add → connect → tools surface in the engine → mock-LLM tool
// call round-trips through the daemon bridge → status/RPC surface.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');

const MCP_SERVER = path.join(__dirname, '..', 'fixtures', 'mock-mcp-server.js');

async function setup(t) {
  const mock = await startMockLlm();
  const home = makeTempHome('t46');
  const ws = path.join(home, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  await d.request('settings.set', { key: 'llm.model', value: 'mock-model' });
  return { mock, d, ws };
}

const fs = require('fs');

test('T46a connector add → connected → tools listed over RPC', { timeout: 30000 }, async (t) => {
  const { d } = await setup(t);
  const added = await d.request('connectors.add', { name: 'mock', command: process.execPath, args: [MCP_SERVER] });
  assert.ok(added.result.id, 'connector id assigned');
  // wait for the async connect
  let connected = false;
  for (let i = 0; i < 20 && !connected; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const list = await d.request('connectors.list');
    connected = list.result[0] && list.result[0].state === 'connected';
  }
  assert.ok(connected, 'connector reached connected state');
  const status = await d.request('connectors.status', {});
  assert.strictEqual(status.result.tools, 1, 'echo tool surfaced');
  // duplicate name refused
  const dup = await d.request('connectors.add', { name: 'mock', command: process.execPath, args: [MCP_SERVER] });
  assert.strictEqual(dup.ok, false);
  assert.match(dup.error.message, /already installed/);
  // toggle off → stop
  await d.request('connectors.toggle', { id: added.result.id, enabled: false });
  const off = await d.request('connectors.list', {});
  assert.strictEqual(off.result[0].enabled, false);
  assert.strictEqual(off.result[0].state, 'stopped');
  await d.request('connectors.toggle', { id: added.result.id, enabled: true });
});

test('T46b connector tool reaches the engine and round-trips a call', { timeout: 30000 }, async (t) => {
  const { mock, d, ws } = await setup(t);
  await d.request('connectors.add', { name: 'mock', command: process.execPath, args: [MCP_SERVER] });
  let connected = false;
  for (let i = 0; i < 20 && !connected; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const list = await d.request('connectors.list');
    connected = list.result[0] && list.result[0].state === 'connected';
  }
  assert.ok(connected, 'connector connected before engine start');
  const s = await d.request('sessions.create', { title: 'T46', mode: 'craft', cwd: ws });
  const sessionId = s.result.id;
  mock.push([
    { tool_calls: [{ id: 'm1', type: 'function',
      function: { name: 'mcp_mock_echo', arguments: '{"text":"hello"}' } }] },
    { content: 'echo came back' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'use the echo tool' });
  const done = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 20000);
  assert.strictEqual(done.payload.reason, 'complete');
  const tr = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result' && m.payload.id === 'm1');
  assert.ok(tr, 'connector tool_result present');
  assert.strictEqual(tr.payload.ok, true, tr.payload.summary);
  // the tool history message carried the MCP content back to the LLM
  const toolMsg = mock.requests[1].messages.find((m) => m.role === 'tool' && m.tool_call_id === 'm1');
  assert.ok(toolMsg && toolMsg.content.includes('echo:hello'), 'MCP result fed back to the model');
});
