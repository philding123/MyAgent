'use strict';
// T07: interaction-mode policy enforcement (ask/plan/craft), engine-enforced.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');

async function setup(t, mode) {
  const mock = await startMockLlm();
  const home = makeTempHome('t07');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t07-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  const s = await d.request('sessions.create', { title: 'T07', mode, cwd: ws });
  return { mock, d, ws, sessionId: s.result.id };
}

const writeCall = (ws) => ({ tool_calls: [{ id: 'c1', type: 'function',
  function: { name: 'write_file', arguments: '{"path":"' + path.join(ws, 'x.txt').replace(/\\/g, '\\\\') + '","content":"nope"}' } }] });

test('T07 ask mode blocks writes and commands (hard rules)', { timeout: 30000 }, async (t) => {
  const { mock, d, ws, sessionId } = await setup(t, 'ask');
  mock.push([
    writeCall(ws),
    { content: 'Ask mode is read-only.' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'create a file for me' });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 15000);
  const tr = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result');
  assert.ok(tr, 'tool_result observed');
  assert.strictEqual(tr.payload.ok, false);
  assert.strictEqual(tr.payload.reason, 'policy');
  assert.ok(!fs.existsSync(path.join(ws, 'x.txt')), 'no file written');
  // system prompt carries the ask-mode hard rules
  assert.match(mock.requests[0].messages[0].content, /Ask mode \(Talk only, hands off\)/);
});

test('T07 plan mode: read-only command allowed, writes need confirm', { timeout: 30000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t, 'plan');
  mock.push([
    { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_command', arguments: '{"command":"echo hi"}' } }] },
    { content: 'ran read-only command' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'check the dir' });
  const evs = [];
  await d.waitEvent((m) => {
    if (m.topic === 'engine:' + sessionId) { evs.push(m.payload); return m.payload.type === 'done'; }
    return false;
  }, 15000);
  const tr = evs.find((e) => e.type === 'tool_result');
  assert.ok(tr, 'tool_result observed');
  assert.strictEqual(tr.ok, true, 'allowlisted read-only command ran without confirm');
  assert.ok(!evs.some((e) => e.type === 'confirm_request'), 'no confirm for allowlisted cmd');
});

test('T07 plan mode: write goes through confirm and denial stops it', { timeout: 30000 }, async (t) => {
  const { mock, d, ws, sessionId } = await setup(t, 'plan');
  mock.push([
    writeCall(ws),
    { content: 'understood, not writing.' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'write x.txt' });
  const cf = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'confirm_request', 15000);
  assert.match(cf.payload.command, /write/);
  await d.request('engine.confirm', { id: cf.payload.id, approved: false });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 15000);
  assert.ok(!fs.existsSync(path.join(ws, 'x.txt')));
  const tr = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result');
  assert.strictEqual(tr.payload.reason, 'denied');
});
