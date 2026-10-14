'use strict';
// T13: memory injection into engine system prompt.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');

test('T13 preference reaches the LLM system message and deletion removes it', { timeout: 30000 }, async (t) => {
  const mock = await startMockLlm();
  const home = makeTempHome('t13');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t13-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });

  const added = await d.request('memory.add', { kind: 'preference', content: 'Prefer concise answers __T13__' });
  assert.ok(added.result.id);

  mock.push([{ content: 'ack' }]);
  const s = await d.request('sessions.create', { title: 'T13', cwd: ws });
  await d.request('engine.start', { sessionId: s.result.id });
  await d.request('engine.userMessage', { sessionId: s.result.id, text: 'hello' });
  await d.waitEvent((m) => m.topic === 'engine:' + s.result.id && m.payload.type === 'done', 15000);
  assert.match(mock.requests[0].messages[0].content, /Prefer concise answers __T13__/);

  await d.request('memory.delete', { id: added.result.id });
  mock.push([{ content: 'ack2' }]);
  await d.request('engine.stop', { sessionId: s.result.id });
  await d.request('engine.start', { sessionId: s.result.id });
  const mark = d.events.length;
  const um = await d.request('engine.userMessage', { sessionId: s.result.id, text: 'again' });
  assert.strictEqual(um.ok, true, um.error && um.error.message);
  await d.waitEvent((m, i) => i >= mark && m.topic === 'engine:' + s.result.id && m.payload.type === 'done', 15000);
  const sys2 = mock.requests[1].messages[0].content;
  assert.ok(!sys2.includes('__T13__'), 'deleted memory no longer injected');
});

test('T13 fact kind also injects', { timeout: 30000 }, async (t) => {
  const mock = await startMockLlm();
  const home = makeTempHome('t13f');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t13f-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  await d.request('memory.add', { kind: 'fact', content: 'workspace uses pnpm __FACT__' });
  mock.push([{ content: 'ok' }]);
  const s = await d.request('sessions.create', { title: 'T13f', cwd: ws });
  await d.request('engine.start', { sessionId: s.result.id });
  await d.request('engine.userMessage', { sessionId: s.result.id, text: 'x' });
  await d.waitEvent((m) => m.topic === 'engine:' + s.result.id && m.payload.type === 'done', 15000);
  assert.match(mock.requests[0].messages[0].content, /workspace uses pnpm __FACT__/);
});
