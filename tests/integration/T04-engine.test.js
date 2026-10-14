'use strict';
// T04: engine end-to-end over the real daemon (mock LLM scripted).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon, sleep } = require('../helpers');

async function setup(t, mode) {
  const mock = await startMockLlm();
  const home = makeTempHome('t04');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t04-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  await d.request('settings.set', { key: 'llm.model', value: 'mock-model' });
  const s = await d.request('sessions.create', { title: 'T04', mode, cwd: ws });
  return { mock, d, ws, sessionId: s.result.id };
}

test('T04a plain text reply streams token events', { timeout: 30000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t, 'craft');
  mock.push([{ content: 'hello human' }]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'hi' });
  const evs = [];
  const done = await d.waitEvent((m) => {
    if (m.topic === 'engine:' + sessionId) { evs.push(m.payload); return m.payload.type === 'done'; }
    return false;
  }, 15000);
  assert.strictEqual(done.payload.reason, 'complete');
  const types = evs.map((e) => e.type);
  assert.ok(types.includes('status'));
  assert.ok(types.includes('token'));
  assert.ok(evs.find((e) => e.type === 'token').text.includes('hello human'));
});

test('T04b tool call loop writes the file', { timeout: 30000 }, async (t) => {
  const { mock, d, ws, sessionId } = await setup(t, 'craft');
  const target = path.join(ws, 'out.txt').replace(/\\/g, '\\\\');
  mock.push([
    { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"' + target + '","content":"engine data"}' } }] },
    { content: 'file written' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'write the file' });
  const last = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 15000);
  assert.strictEqual(last.payload.reason, 'complete');
  assert.strictEqual(fs.readFileSync(path.join(ws, 'out.txt'), 'utf8'), 'engine data');
  const toolResult = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result');
  assert.ok(toolResult, 'saw tool_result');
  assert.strictEqual(toolResult.payload.ok, true);
  const req = mock.requests[0];
  assert.ok(req.tools.length >= 6, 'tool definitions sent to LLM');
  assert.strictEqual(req.messages[0].role, 'system');
  assert.match(req.messages[0].content, /Craft mode/);
});
