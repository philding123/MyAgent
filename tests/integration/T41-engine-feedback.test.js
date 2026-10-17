'use strict';
// T41: engine feedback surface (F48/F49) — todo plan events, step fields on
// tool_call, cumulative usageTokens on done.
// T42b: context compaction over the real daemon (F50) — a tool-heavy task with
// engine.maxContextChars set keeps later requests bounded and marked.
// T43: conversation persistence (D10/F51) — assistant/tool messages land in
// the store so reopen replays the full exchange.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');

async function setup(t) {
  const mock = await startMockLlm();
  const home = makeTempHome('t41');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t41-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  await d.request('settings.set', { key: 'llm.model', value: 'mock-model' });
  const s = await d.request('sessions.create', { title: 'T41', mode: 'craft', cwd: ws });
  return { mock, d, ws, sessionId: s.result.id };
}

test('T41 todo events + step fields + usageTokens on done', { timeout: 30000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t);
  const todoCall = (items, id) => ({ id, type: 'function',
    function: { name: 'todo', arguments: JSON.stringify({ items }) } });
  mock.push([
    { tool_calls: [todoCall([{ text: '调研', done: false }, { text: '写报告', done: false }], 't1')], __usage: 10 },
    { tool_calls: [todoCall([{ text: '调研', done: true }, { text: '写报告', done: false }], 't2')], __usage: 20 },
    { content: 'plan complete', __usage: 30 },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'plan it' });
  const done = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 20000);
  assert.strictEqual(done.payload.reason, 'complete');
  assert.strictEqual(done.payload.usageTokens, 60, 'cumulative provider usage');
  const todos = d.events.filter((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'todo');
  assert.strictEqual(todos.length, 2, 'plan updates surfaced');
  assert.deepStrictEqual(todos[1].payload.todos.map((x) => x.done), [true, false]);
  const calls = d.events.filter((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_call');
  assert.deepStrictEqual(calls.map((c) => c.payload.step), [1, 2]);
  assert.ok(calls[0].payload.maxSteps >= 4, 'budget rides the event');
});

test('T42b compaction bounds real daemon requests on tool-heavy tasks', { timeout: 30000 }, async (t) => {
  const { mock, d, ws, sessionId } = await setup(t);
  await d.request('settings.set', { key: 'engine.maxContextChars', value: '4000' });
  const big = 'x'.repeat(8000);
  for (let i = 1; i <= 3; i++) {
    mock.push([{ tool_calls: [{ id: 'w' + i, type: 'function',
      function: { name: 'write_file', arguments: '{"path":"' + path.join(ws, 'f' + i + '.txt').replace(/\\/g, '\\\\') + '","content":"' + big + '"}' } }] }]);
  }
  mock.push([{ content: 'done writing' }]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'write files' });
  const done = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 20000);
  assert.strictEqual(done.payload.reason, 'complete');
  const lastReq = mock.requests[mock.requests.length - 1];
  assert.ok(lastReq.messages.length <= 8, 'later requests stay bounded, got ' + lastReq.messages.length);
  assert.ok(lastReq.messages.some((m) => String(m.content).includes('[context compacted')), 'compaction marker present');
  assert.ok(JSON.stringify(lastReq.messages).length < 20000, 'request size bounded');
});

test('T43 assistant and tool messages persist for reopen (D10)', { timeout: 30000 }, async (t) => {
  const { mock, d, ws, sessionId } = await setup(t);
  const target = path.join(ws, 'out.txt').replace(/\\/g, '\\\\');
  mock.push([
    { tool_calls: [{ id: 'w1', type: 'function', function: { name: 'write_file', arguments: '{"path":"' + target + '","content":"x"}' } }] },
    { content: 'file written' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'write it' });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 20000);
  const s = await d.request('sessions.get', { id: sessionId });
  const msgs = s.result.messages;
  assert.deepStrictEqual(msgs.map((m) => m.role), ['user', 'tool', 'assistant'], 'full exchange stored');
  assert.strictEqual(msgs[0].content, 'write it');
  assert.strictEqual(msgs[1].tool_name, 'write_file');
  assert.match(msgs[1].content, /wrote /);
  assert.strictEqual(JSON.parse(msgs[1].tool_json).ok, true);
  assert.strictEqual(msgs[2].content, 'file written');
});
