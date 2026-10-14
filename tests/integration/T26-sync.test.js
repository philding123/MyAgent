'use strict';
// T26: session sync — directory target via two real daemon instances sharing
// one sync folder, plus rev-conflict preservation.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeTempHome, forkDaemon } = require('../helpers');
const { openStore } = require('../../app/daemon/store');
const { SyncService, SyncTargetDirectory } = require('../../app/daemon/sync');

test('T26 two daemons sync through a shared directory target', { timeout: 60000 }, async (t) => {
  const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't26-sync-'));
  const homeA = makeTempHome('t26a');
  const homeB = makeTempHome('t26b');
  const a = forkDaemon(homeA);
  const b = forkDaemon(homeB);
  t.after(() => { a.child.kill(); b.child.kill(); });
  for (const d of [a, b]) await d.waitEvent((m) => m.topic === 'daemon:ready', 15000);

  const cfg = { type: 'directory', path: syncRoot };
  const ca = await a.request('sync.configure', { config: cfg });
  assert.strictEqual(ca.result.type, 'directory');
  await b.request('sync.configure', { config: cfg });

  // A creates a session with messages and pushes
  const s = await a.request('sessions.create', { title: 'synced session' });
  await a.request('sessions.appendMessage', { session_id: s.result.id, role: 'user', content: 'from A' });
  const push = await a.request('sync.push');
  assert.strictEqual(push.result.ok, true, JSON.stringify(push));
  assert.strictEqual(push.result.pushed, 1);

  // B pulls and sees it
  const pull = await b.request('sync.pull');
  assert.strictEqual(pull.result.ok, true);
  assert.strictEqual(pull.result.applied, 1);
  const listB = await b.request('sessions.list');
  const imported = listB.result.find((x) => x.title === 'synced session');
  assert.ok(imported, 'session imported into B');
  const got = await b.request('sessions.get', { id: imported.id });
  assert.ok(got.result.messages.some((m) => m.content === 'from A'), 'messages carried over');

  // B appends and pushes; A pulls the newer rev
  await b.request('sessions.appendMessage', { session_id: imported.id, role: 'user', content: 'from B' });
  await b.request('sync.push');
  const pullA = await a.request('sync.pull');
  assert.strictEqual(pullA.result.ok, true);
  const gotA = await a.request('sessions.get', { id: s.result.id });
  assert.ok(gotA.result.messages.some((m) => m.content === 'from B'), 'A sees B addition');

  // status fields
  const st = await a.request('sync.status');
  assert.ok(st.result.lastPush || st.result.lastPull);
  assert.strictEqual(st.result.type, 'directory');
});

test('T26 rev conflict preserves both sides (store-level)', { timeout: 30000 }, async (t) => {
  const syncRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't26-conf-'));
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 't26a2-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 't26b2-'));
  const storeA = openStore(dirA).store;
  const storeB = openStore(dirB).store;
  const target = new SyncTargetDirectory(syncRoot);

  const sa = new SyncService({ store: storeA, target });
  sa.configure({ type: 'directory', path: syncRoot });
  const sb = new SyncService({ store: storeB, target });
  sb.configure({ type: 'directory', path: syncRoot });

  const rowA = storeA.createSession({ id: 'conf1', title: 'conflict' });
  storeA.appendMessage({ session_id: 'conf1', role: 'user', content: 'A v1' });
  const r1 = await sa.push();
  assert.strictEqual(r1.pushed, 1);

  // B pulls A's rev1, then diverges and pushes rev2
  await sb.pull();
  storeB.appendMessage({ session_id: 'conf1', role: 'user', content: 'B v2' });
  await sb.push();

  // A also diverges locally (still at rev1 → remote rev2 is newer → remote wins,
  // local copy snapshotted as .local-conflict)
  storeA.appendMessage({ session_id: 'conf1', role: 'user', content: 'A local divergence' });
  const r2 = await sb.pull();
  assert.strictEqual(r2.applied, 0, 'B has nothing new');
  const pullA2 = await sa.pull();
  assert.strictEqual(pullA2.ok, true);

  const merged = storeA.getSession('conf1');
  const msgs = storeA.listMessages('conf1').map((m) => m.content);
  assert.ok(msgs.includes('B v2'), 'remote-wins applied');
  assert.ok(fs.existsSync(path.join(syncRoot, 'myagent-sync', 'sessions', 'conf1.local-conflict.json')),
    'local divergence preserved as conflict artifact');
  assert.ok(merged, 'session still present');
});
