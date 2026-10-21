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

test('T04c repeated engine.start re-pipes once — no duplicate events', { timeout: 60000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t, 'craft');
  // the renderer calls engine.start before every turn (engineRunning resets on
  // done); re-piping must replace the listener, never stack it (3x card bug)
  for (let i = 1; i <= 3; i++) {
    mock.push([{ content: 'reply-' + i }]);
    await d.request('engine.start', { sessionId });
    await d.request('engine.userMessage', { sessionId, text: 'q' + i });
    // waitEvent's history scan stops at the first done (previous turns'), so
    // pin this turn: collect reply-i tokens, resolve on the done after one
    const tokens = [];
    let seen = false;
    await d.waitEvent((m) => {
      if (m.topic !== 'engine:' + sessionId) return false;
      if (m.payload.type === 'token' && m.payload.text === 'reply-' + i) { tokens.push(m.payload); seen = true; return false; }
      return seen && m.payload.type === 'done';
    }, 20000);
    assert.strictEqual(tokens.length, 1, 'turn ' + i + ' token delivered exactly once');
  }
});

test('T04d failed run_command carries stderr detail for the UI', { timeout: 30000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t, 'craft');
  // no quotes/specials: they get eaten by execFile + cmd /s /c double-quoting
  const cmd = process.platform === 'win32' ? 'dir NOSUCHFILE_xyz.TXT' : 'ls NOSUCHFILE_xyz';
  mock.push([
    { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: cmd }) } }] },
    { content: 'recovered' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'try the failing command' });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 20000);
  const tr = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result' && m.payload.ok === false);
  assert.ok(tr, 'saw failing tool_result');
  assert.match(tr.payload.summary, /exit [1-9]/); // dir → 1, GNU ls → 2
  assert.ok(tr.payload.detail && tr.payload.detail.includes('[stderr]'), 'stderr tail surfaced as detail');
  // the LLM still receives the full data payload via the tool history message
  const toolMsg = mock.requests[1].messages.find((m) => m.role === 'tool' && m.tool_call_id === 'c2');
  assert.ok(toolMsg && toolMsg.content.includes('"stderr"'), 'LLM tool message keeps stderr data');
});
