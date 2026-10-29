'use strict';
// T54 integration (F58, design/42): the daemon hook snapshots local
// write_file/present_file artifacts (once per file per turn) and the
// files.history.* RPCs round-trip a real rollback under the workspace gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeTempHome } = require('../helpers');
const { createDaemon } = require('../../app/daemon');

function boot(t, tag, settings = {}) {
  const home = makeTempHome('t54-' + tag);
  const prev = process.env.MYAGENT_HOME;
  process.env.MYAGENT_HOME = home;
  const d = createDaemon({ send: () => {} });
  for (const [k, v] of Object.entries(settings)) d.store.setSetting(k, v);
  t.after(() => {
    d.shutdown();
    if (prev === undefined) delete process.env.MYAGENT_HOME; else process.env.MYAGENT_HOME = prev;
  });
  return d;
}

function writeTurn(d, sid, callId, target, content, tool = 'write_file') {
  d.emit('engine:' + sid, { type: 'status', stage: 'thinking' });
  d.emit('engine:' + sid, { type: 'tool_call', id: callId, name: tool });
  d.emit('engine:' + sid, { type: 'tool_result', id: callId, ok: true, summary: 'written',
    artifact: { path: target, name: path.basename(target), location: 'local' } });
}

test('T54 hook snapshots writes once per file per turn; RPC list/restore round-trip', async (t) => {
  const d = boot(t, 'rpc');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't54-ws-'));
  d.store.createSession({ id: 's1', cwd: ws });
  const f = path.join(ws, 'doc.md');
  fs.writeFileSync(f, '# v1\n');
  writeTurn(d, 's1', 'c1', f);
  fs.writeFileSync(f, '# v1\nchanged in the same turn\n');
  writeTurn(d, 's1', 'c1b', f); // same file, same turn id semantics: new thinking = new turn? no —
  // c1b is a second turn (two thinking events) → second snapshot
  const list = await d.methods['files.history.list']({ path: f });
  assert.equal(list.versions.length, 2);
  assert.equal(list.versions[0].sessionId, 's1');
  fs.writeFileSync(f, '# totally different\n');
  const restored = await d.methods['files.history.restore']({ path: f, sessionId: 's1', versionId: '1' });
  assert.equal(restored.ok, true);
  assert.equal(fs.readFileSync(f, 'utf8'), '# v1\n');
  // restore pre-snapshotted the overwritten content → undoable
  const after = await d.methods['files.history.list']({ path: f });
  assert.deepEqual(after.versions.map((v) => v.id + ':' + v.tool),
    ['3:restore-pre', '2:write_file', '1:write_file']);
  const diff = await d.methods['files.history.diff']({ path: f, versionId: '3' });
  assert.equal(diff.ok, true);
  assert.deepEqual(diff.lines.filter((l) => l.type === 'del' || l.type === 'add'),
    [{ type: 'del', text: '# v1' }, { type: 'add', text: '# totally different' }]);
  const del = await d.methods['files.history.delete']({ path: f, sessionId: 's1', versionId: '3' });
  assert.equal(del.removed, '3');
  assert.equal((await d.methods['files.history.list']({ path: f })).versions.length, 2);
});

test('T54 same turn, same file: one snapshot even across two tool calls', async (t) => {
  const d = boot(t, 'dedup');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't54-dedup-'));
  d.store.createSession({ id: 's1', cwd: ws });
  const f = path.join(ws, 'a.txt');
  fs.writeFileSync(f, 'x1');
  d.emit('engine:s1', { type: 'status', stage: 'thinking' });
  d.emit('engine:s1', { type: 'tool_call', id: 'a', name: 'write_file' });
  d.emit('engine:s1', { type: 'tool_result', id: 'a', ok: true, summary: 'w',
    artifact: { path: f, name: 'a.txt', location: 'local' } });
  fs.writeFileSync(f, 'x2');
  d.emit('engine:s1', { type: 'tool_call', id: 'b', name: 'write_file' });
  d.emit('engine:s1', { type: 'tool_result', id: 'b', ok: true, summary: 'w',
    artifact: { path: f, name: 'a.txt', location: 'local' } });
  const list = await d.methods['files.history.list']({ path: f });
  assert.equal(list.versions.length, 1, 'per-turn dedup keeps one snapshot');
  assert.equal(list.versions[0].tool, 'write_file');
});

test('T54 present_file delivery snapshots too; failed writes never do', async (t) => {
  const d = boot(t, 'present');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't54-present-'));
  d.store.createSession({ id: 's1', cwd: ws });
  const f = path.join(ws, 'out.txt');
  fs.writeFileSync(f, 'delivered');
  d.emit('engine:s1', { type: 'status', stage: 'thinking' });
  d.emit('engine:s1', { type: 'tool_call', id: 'p1', name: 'present_file' });
  d.emit('engine:s1', { type: 'tool_result', id: 'p1', ok: true, summary: 'delivered',
    artifact: { path: f, name: 'out.txt', location: 'local' } });
  d.emit('engine:s1', { type: 'tool_call', id: 'p2', name: 'present_file' });
  d.emit('engine:s1', { type: 'tool_result', id: 'p2', ok: false, summary: 'refused',
    artifact: { path: f, name: 'out.txt', location: 'local' } });
  const list = await d.methods['files.history.list']({ path: f });
  assert.equal(list.versions.length, 1);
  assert.equal(list.versions[0].tool, 'present_file');
});

test('T54 restore is workspace-gated and fails closed outside', async (t) => {
  const d = boot(t, 'gate');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't54-gate-'));
  d.store.createSession({ id: 's1', cwd: ws });
  const outside = path.join(os.homedir(), 'myagent-t54-gate-' + Date.now() + '.txt');
  fs.writeFileSync(outside, 'v1');
  t.after(() => { try { fs.unlinkSync(outside); } catch (_) {} });
  d.emit('engine:s1', { type: 'status', stage: 'thinking' });
  d.emit('engine:s1', { type: 'tool_call', id: 'o', name: 'write_file' });
  d.emit('engine:s1', { type: 'tool_result', id: 'o', ok: true, summary: 'w',
    artifact: { path: outside, name: path.basename(outside), location: 'local' } });
  const list = await d.methods['files.history.list']({ path: outside });
  assert.equal(list.versions.length, 1, 'record itself is read-only and ungated');
  await assert.rejects(() => d.methods['files.history.restore']({ path: outside, sessionId: 's1', versionId: '1' }),
    (e) => e.code === 'sandbox_denied');
  await assert.rejects(() => d.methods['files.history.delete']({ path: outside, sessionId: 's1' }),
    (e) => e.code === 'sandbox_denied');
  await assert.rejects(() => d.methods['files.history.restore']({ path: outside, sessionId: 'ghost', versionId: '1' }),
    (e) => e.code === 'no_session');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'v1', 'untouched');
});

test('T54 fileHistory.enable=false stops snapshots at the hook', async (t) => {
  const d = boot(t, 'off', { 'fileHistory.enable': false });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 't54-off-'));
  d.store.createSession({ id: 's1', cwd: ws });
  const f = path.join(ws, 'b.txt');
  fs.writeFileSync(f, 'nope');
  writeTurn(d, 's1', 'c1', f);
  const list = await d.methods['files.history.list']({ path: f });
  assert.deepEqual(list.versions, []);
});
