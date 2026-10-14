'use strict';
// T09: dangerous-command confirmation gate (craft mode).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');

async function setup(t) {
  const mock = await startMockLlm();
  const home = makeTempHome('t09');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t09-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  const s = await d.request('sessions.create', { title: 'T09', mode: 'craft', cwd: ws });
  return { mock, d, ws, sessionId: s.result.id };
}

const cmdCall = (cmd) => ({ tool_calls: [{ id: 'c9', type: 'function',
  function: { name: 'run_command', arguments: JSON.stringify({ command: cmd }) } }] });

test('T09a sandbox deny pattern blocks rm -rf without confirm', { timeout: 30000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t);
  mock.push([cmdCall('rm -rf C:\\important'), { content: 'ok I will not.' }]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'clean up' });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 15000);
  const tr = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result');
  assert.strictEqual(tr.payload.ok, false);
  assert.strictEqual(tr.payload.reason, 'sandbox'); // deny_rules verdict kind; blocked pre-execution
  assert.ok(!d.events.some((m) => m.payload.type === 'confirm_request'));
});

test('T09b confirm pattern asks, denial stops execution', { timeout: 30000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t);
  mock.push([cmdCall('git push origin main'), { content: 'as you wish.' }]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'push it' });
  const cf = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'confirm_request', 15000);
  assert.match(cf.payload.command, /git push/);
  await d.request('engine.confirm', { id: cf.payload.id, approved: false });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 15000);
  const tr = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result');
  assert.strictEqual(tr.payload.reason, 'denied');
  assert.strictEqual(tr.payload.ok, false);
});

test('T09c approved confirm executes the command', { timeout: 30000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t);
  const marker = 'T9C-' + Date.now();
  mock.push([cmdCall('echo ' + marker + ' & git push'), { content: 'done' }]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'go' });
  const cf = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'confirm_request', 15000);
  await d.request('engine.confirm', { id: cf.payload.id, approved: true });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 15000);
  const tr = d.events.find((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result');
  assert.ok(tr.payload.summary.includes('exit'), 'command actually executed: ' + tr.payload.summary);
  assert.strictEqual(tr.payload.reason, undefined);
});
