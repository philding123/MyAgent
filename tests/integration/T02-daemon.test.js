'use strict';
// T02: daemon RPC protocol + reconnect (DaemonClient used by Electron main).
const test = require('node:test');
const assert = require('node:assert');
const { makeTempHome, forkDaemon } = require('../helpers');
const { DaemonClient } = require('../../app/main/daemon-client');

test('T02a daemon method roundtrip + unknown method + ready snapshot', { timeout: 30000 }, async (t) => {
  const home = makeTempHome('t02');
  const d = forkDaemon(home);
  t.after(() => d.child.kill());
  const ready = await d.waitEvent((m) => m.topic === 'daemon:ready', 15000);
  assert.ok(ready.payload.sessions, 'snapshot has sessions');
  const v = await d.request('app.version');
  assert.strictEqual(v.ok, true);
  assert.ok(v.result.version);
  const bad = await d.request('no.such.method');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error.code, 'no_method');
  const s = await d.request('sessions.create', { title: 'T02' });
  const list = await d.request('sessions.list');
  assert.ok(list.result.some((x) => x.id === s.result.id));
});

test('T02b DaemonClient restarts daemon after crash', { timeout: 40000 }, async (t) => {
  const home = makeTempHome('t02b');
  const client = new DaemonClient();
  t.after(() => client.shutdown());
  const ready1 = new Promise((res) => client.once('ready', res));
  client.start();
  await ready1;
  const r1 = await client.request('app.version');
  assert.strictEqual(r1.ok, true);
  // crash the daemon
  const down = new Promise((res) => client.once('down', res));
  client.child.kill('SIGKILL');
  await down;
  // wait for reconnect
  await new Promise((res, rej) => {
    const t2 = setTimeout(() => rej(new Error('no reconnect in 15s')), 15000);
    client.once('ready', () => { clearTimeout(t2); res(); });
  });
  const r2 = await client.request('app.version');
  assert.strictEqual(r2.ok, true, 'works after restart');
});

test('T18a selfcheck reports capability matrix', { timeout: 30000 }, async (t) => {
  const home = makeTempHome('t18');
  const d = forkDaemon(home);
  t.after(() => d.child.kill());
  const sc = await d.request('app.selfcheck');
  const r = sc.result;
  assert.ok(r.version);
  assert.ok(r.store && r.store.ok, 'store healthy');
  assert.ok(['sqlite', 'json'].includes(r.store.mode));
  assert.ok(r.terminal && ['pty', 'pipe'].includes(r.terminal.kind));
  assert.strictEqual(r.sandbox.enabled, true);
  assert.ok(r.skills.count >= 2, 'builtin skills found');
  assert.ok(r.vault.mode);
  assert.ok(r.dataDir);
});
