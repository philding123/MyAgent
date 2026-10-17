'use strict';
// T39b: present_file end-to-end — the engine tool_result event carries
// {artifact:{path,name}} pointing at the (env-isolated) delivery folder.
// T40: per-task step budget (F45) — engine.maxSteps via daemon settings bounds
// the loop with done(reason='max-steps'), and the engine stays continuable.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');

async function setup(t, extraEnv) {
  const mock = await startMockLlm();
  const home = makeTempHome('t39t40');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t39t40-ws-'));
  const d = forkDaemon(home, extraEnv);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  await d.request('settings.set', { key: 'llm.model', value: 'mock-model' });
  const s = await d.request('sessions.create', { title: 'T39/T40', mode: 'craft', cwd: ws });
  return { mock, d, ws, sessionId: s.result.id };
}

test('T39b present_file tool_result carries artifact info', { timeout: 30000 }, async (t) => {
  const deliv = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t39-deliv-'));
  const { mock, d, ws, sessionId } = await setup(t, { MYAGENT_DELIVERY_DIR: deliv });
  fs.writeFileSync(path.join(ws, 'out.html'), '<html>done</html>');
  const target = path.join(ws, 'out.html').replace(/\\/g, '\\\\');
  mock.push([
    { tool_calls: [{ id: 'p1', type: 'function', function: { name: 'present_file', arguments: '{"path":"' + target + '"}' } }] },
    { content: 'delivered' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'deliver it' });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 20000);
  const tr = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result' && m.payload.id === 'p1');
  assert.ok(tr, 'saw present_file tool_result');
  assert.strictEqual(tr.payload.ok, true);
  assert.ok(tr.payload.artifact && tr.payload.artifact.path.startsWith(deliv), 'artifact points at the delivery folder');
  assert.strictEqual(tr.payload.artifact.name, 'out.html');
  assert.strictEqual(fs.readFileSync(tr.payload.artifact.path, 'utf8'), '<html>done</html>');
});

test('T40 engine.maxSteps bounds the loop and stays continuable', { timeout: 60000 }, async (t) => {
  const { mock, d, ws, sessionId } = await setup(t, {});
  await d.request('settings.set', { key: 'engine.maxSteps', value: '2' });
  // every turn wants another write → the budget, not the model, ends the loop.
  // settings '2' is clamped to the floor of 4 (engine clamps 4..256), so push
  // four tool-call responses and expect all four to execute before the budget
  const mk = (i) => ({ tool_calls: [{ id: 'c' + i, type: 'function',
    function: { name: 'write_file', arguments: '{"path":"' + path.join(ws, 'f' + i + '.txt').replace(/\\/g, '\\\\') + '","content":"x"}' } }] });
  mock.push([mk(1), mk(2), mk(3), mk(4)]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'loop' });
  const done1 = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 20000);
  assert.strictEqual(done1.payload.reason, 'max-steps', 'budget ends the turn');
  for (let i = 1; i <= 4; i++) assert.ok(fs.existsSync(path.join(ws, 'f' + i + '.txt')), 'step ' + i + ' executed in budget');
  // continue on the same live engine: history intact, fresh budget
  mock.push([{ content: 'finished now' }]);
  const before = d.events.length; // waitEvent scans history first — pin to post-continue events
  await d.request('engine.userMessage', { sessionId, text: '继续' });
  const done2 = await d.waitEvent((m, i) => i >= before && m.topic === 'engine:' + sessionId && m.payload.type === 'done', 20000);
  assert.strictEqual(done2.payload.reason, 'complete');
  assert.ok(fs.existsSync(path.join(ws, 'f2.txt')), 'continuation ran on the same engine');
});
