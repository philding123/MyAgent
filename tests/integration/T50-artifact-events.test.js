'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');
const { createDaemon } = require('../../app/daemon');

// send runs synchronously at the event boundary: this detects the historical
// broadcast-before-persistence race without depending on IPC scheduling.
test('T50 daemon persists normalized metadata before broadcast; failed persistence strips artifact', async (t) => {
  const home = makeTempHome('t50-direct');
  const prev = process.env.MYAGENT_HOME; process.env.MYAGENT_HOME = home;
  let d; const observed = [];
  t.after(() => { d.shutdown(); if (prev === undefined) delete process.env.MYAGENT_HOME; else process.env.MYAGENT_HOME = prev; });
  d = createDaemon({ send: (event) => {
    if (event.payload?.type === 'tool_result') observed.push({ event, rows: d.store.listMessages('s1') });
  } });
  d.store.createSession({ id: 's1', cwd: os.tmpdir() }); d.store.createSession({ id: 's2', cwd: os.tmpdir() });
  const emit = (sid, id, ok, extra = {}) => {
    d.emit('engine:' + sid, { type: 'tool_call', id, name: 'write_file' });
    d.emit('engine:' + sid, { type: 'tool_result', id, ok, summary: 'written', detail: 'unchanged',
      artifact: { path: path.join(os.tmpdir(), 'a.txt'), name: 'fake', location: 'local' }, ...extra });
  };
  emit('s1', 'c1', true);
  assert.equal(observed[0].rows.length, 1);
  const saved = JSON.parse(observed[0].rows[0].tool_json);
  assert.equal(saved.ok, true); assert.equal(saved.detail, 'unchanged');
  assert.deepEqual(saved.artifact, observed[0].event.payload.artifact);
  assert.deepEqual(Object.keys(saved.artifact).sort(), ['schemaVersion', 'sessionId', 'toolCallId', 'path', 'name', 'sourceTool', 'createdAt', 'kind', 'location'].sort());
  assert.equal(saved.artifact.name, 'a.txt'); assert.equal(saved.artifact.sessionId, 's1');
  emit('s1', 'failed', false);
  assert.equal(observed[1].event.payload.artifact, undefined);
  assert.equal(JSON.parse(observed[1].rows[1].tool_json).artifact, undefined);
  emit('s2', 'background', true);
  assert.equal((await d.methods['artifacts.list']({ sessionId: 's2' }))[0].toolCallId, 'background');
  assert.equal((await d.methods['artifacts.list']({ sessionId: 's1' })).length, 1);
  const append = d.store.appendMessage;
  d.store.appendMessage = () => { throw new Error('disk full'); };
  emit('s1', 'disk-full', true);
  assert.equal(observed.at(-1).event.payload.artifact, undefined);
  d.store.appendMessage = append;
  const secret = path.join(home, 'keystore', 't50-private.txt');
  fs.writeFileSync(secret, 'must never escape');
  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t50-preview-'));
  const link = path.join(linkRoot, 'preview.txt');
  t.after(() => fs.rmSync(linkRoot, { recursive: true, force: true }));
  try { fs.symlinkSync(secret, link); }
  catch (e) { if (e.code === 'EPERM') { t.diagnostic('Windows symlink privilege unavailable for files.readBinary test'); return; } throw e; }
  await assert.rejects(d.methods['files.readBinary']({ path: link }), { code: 'sandbox_denied' });
  d.store.appendMessage({ session_id: 's1', role: 'tool', tool_name: 'write_file', tool_json: JSON.stringify({ ok: true,
    artifact: { schemaVersion: 1, sessionId: 's1', toolCallId: 'secret-link', sourceTool: 'write_file',
      path: link, location: 'local', kind: 'working', createdAt: Date.now() } }) });
  await assert.rejects(d.methods['artifacts.resolve']({ sessionId: 's1', path: link, operation: 'preview' }), { code: 'sandbox_denied' });
});

test('T50 actual engine successful writes/delivery replay across daemon restart and sessions', { timeout: 40000 }, async (t) => {
  const mock = await startMockLlm();
  const home = makeTempHome('t50-events');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t50-ws-'));
  const delivery = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t50-delivery-'));
  let d = forkDaemon(home, { MYAGENT_DELIVERY_DIR: delivery });
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  const sessionId = (await d.request('sessions.create', { title: 'T50', mode: 'craft', cwd: ws })).result.id;
  const other = (await d.request('sessions.create', { title: 'other', cwd: ws })).result.id;
  const target = path.join(ws, 'report.txt');
  const tool = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  mock.push([
    { tool_calls: [tool('w1', 'write_file', { path: target, content: 'one' }),
      tool('w2', 'write_file', { path: target, content: 'two' }),
      tool('denied', 'write_file', { path: path.join(os.homedir(), '.ssh', 'no-write.txt'), content: 'denied' }),
      tool('p1', 'present_file', { path: target }),
      tool('missing', 'present_file', { path: path.join(ws, 'missing.txt') })] },
    { content: 'done' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'produce report' });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 25000);
  const events = d.events.filter((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'tool_result');
  assert.equal(events.length, 5);
  for (const id of ['denied', 'missing']) {
    const p = events.find((e) => e.payload.id === id).payload;
    assert.equal(p.ok, false); assert.equal(p.artifact, undefined);
  }
  const list = (await d.request('artifacts.list', { sessionId })).result;
  assert.equal(list.length, 2); assert.equal(list[0].toolCallId, 'w2');
  assert.equal(list[0].kind, 'working'); assert.equal(list[1].kind, 'delivered');
  assert.equal(list[1].location, 'local');
  const rows = (await d.request('messages.list', { sessionId })).result;
  const delivered = JSON.parse(rows.find((m) => m.tool_name === 'present_file' && JSON.parse(m.tool_json).ok).tool_json).artifact;
  assert.deepEqual(delivered, list[1]);
  const denied = await d.request('artifacts.resolve', { sessionId: other, path: target, operation: 'copy' });
  assert.equal(denied.ok, false); assert.equal(denied.error.code, 'not_artifact');
  const resolved = await d.request('artifacts.resolve', { sessionId, path: target, operation: 'open' });
  assert.equal(resolved.ok, true); assert.equal(resolved.result.path, fs.realpathSync(target));
  const closed = once(d.child, 'exit'); d.child.disconnect(); await closed;
  d = forkDaemon(home, { MYAGENT_DELIVERY_DIR: delivery });
  const restored = await d.request('artifacts.list', { sessionId });
  assert.deepEqual(restored.result, list);
  await d.request('sessions.delete', { id: sessionId });
  assert.equal(fs.existsSync(delivered.path), true);
  assert.equal((await d.request('artifacts.list', { sessionId })).error.code, 'no_session');
});
