'use strict';
// T54 (F58 file history, design/42): snapshot recording, prune/expiry,
// guards, restore semantics (pre-snapshot + checksum fail-closed), diff,
// and the RPC-layer workspace gate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createFileHistory, createFileHistoryApi, diffLines, assertLocalPath } = require('../../app/daemon/file-history');
const { Sandbox, defaultRules } = require('../../app/daemon/sandbox');

function setup(raw = {}, nowMs) {
  // caller passes {count: 3, enable: false, ...}; prefix to the real keys
  const settings = {};
  for (const [k, v] of Object.entries(raw)) settings['fileHistory.' + k] = v;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-'));
  let now = nowMs ?? 1700000000000;
  const fh = createFileHistory({
    dir: path.join(tmp, 'filehistory'),
    getSetting: (k) => (k in settings ? settings[k] : null),
    log: () => {},
    now: () => now,
  });
  return { tmp, fh, file: (name) => path.join(tmp, name), tick: (ms) => { now += ms; }, setNow: (ms) => { now = ms; } };
}

test('T54 record/list roundtrip with sha256 and newest-first order', () => {
  const { fh, file } = setup();
  const f = file('a.txt');
  fs.writeFileSync(f, 'one\n');
  assert.equal(fh.record(f, { sessionId: 's1', tool: 'write_file' }).ok, true);
  fs.writeFileSync(f, 'one\ntwo\n');
  assert.equal(fh.record(f, { sessionId: 's1', tool: 'write_file' }).ok, true);
  const { versions } = fh.list(f);
  assert.deepEqual(versions.map((v) => v.id), ['2', '1']);
  assert.equal(versions[0].sha256, crypto.createHash('sha256').update('one\ntwo\n').digest('hex'));
  assert.equal(versions[0].tool, 'write_file');
  assert.equal(versions[0].sessionId, 's1');
  assert.equal(versions.every((v) => v.skipped === false), true);
});

test('T54 per-file count cap keeps the newest versions only', () => {
  const { fh, file } = setup({ count: 3 });
  const f = file('b.txt');
  for (let i = 1; i <= 5; i++) { fs.writeFileSync(f, 'v' + i); fh.record(f, { sessionId: 's1' }); }
  assert.deepEqual(fh.list(f).versions.map((v) => v.id), ['5', '4', '3']);
});

test('T54 expireDays prune drops old versions on record and pruneAll', () => {
  const { fh, file, tick } = setup({ expireDays: 30 });
  const f = file('c.txt');
  fs.writeFileSync(f, 'old'); fh.record(f, { sessionId: 's1' });
  tick(31 * 86400000 + 1000);
  fs.writeFileSync(f, 'new'); fh.record(f, { sessionId: 's1' });
  assert.deepEqual(fh.list(f).versions.map((v) => v.id), ['2'], 'record prunes the expired sibling');
  tick(31 * 86400000 + 1000);
  fh.pruneAll();
  assert.deepEqual(fh.list(f).versions, [], 'pruneAll removes a fully expired history');
});

test('T54 oversize files record a skipped tombstone, restore refuses them', () => {
  const { fh, file } = setup({ maxFileBytes: 8 });
  const f = file('big.bin');
  fs.writeFileSync(f, '0123456789abcdef');
  const rec = fh.record(f, { sessionId: 's1' });
  assert.equal(rec.ok, true);
  assert.equal(rec.version.skipped, 'too_large');
  const { versions } = fh.list(f);
  assert.equal(versions[0].skipped, 'too_large');
  assert.equal(versions[0].sha256, null);
  assert.throws(() => fh.restore(f, versions[0].id), (e) => e.code === 'not_snapshot');
});

test('T54 total-bytes cap evicts oldest snapshots FIFO', () => {
  const { fh, file, tick } = setup({ maxTotalBytes: 30 });
  const a = file('x.txt'); const b = file('y.txt');
  fs.writeFileSync(a, '0123456789'); fs.writeFileSync(b, '0123456789');
  fh.record(a, { sessionId: 's1' }); tick(5);
  fh.record(b, { sessionId: 's1' }); tick(5);
  fs.writeFileSync(a, 'abcdefghij'); fh.record(a, { sessionId: 's1' }); tick(5); // 30 bytes total
  assert.deepEqual(fh.list(a).versions.map((v) => v.id), ['2', '1']);
  fs.writeFileSync(b, 'klmnopqrst'); fh.record(b, { sessionId: 's1' }); // 40 → evict oldest (a v1)
  fh.pruneAll(); // total-cap eviction runs in the debounced/startup prune
  assert.deepEqual(fh.list(a).versions.map((v) => v.id), ['2'], 'oldest snapshot evicted');
  assert.deepEqual(fh.list(b).versions.map((v) => v.id), ['2', '1']);
});

test('T54 restore snapshots the current content first, so a rollback is undoable', () => {
  const { fh, file } = setup();
  const f = file('d.txt');
  fs.writeFileSync(f, 'original'); fh.record(f, { sessionId: 's1' });
  fs.writeFileSync(f, 'mutated'); fh.record(f, { sessionId: 's1' });
  const r = fh.restore(f, '1');
  assert.equal(r.ok, true); assert.equal(r.restoredVersion, '1'); assert.equal(r.preSnapshotted, true);
  assert.equal(fs.readFileSync(f, 'utf8'), 'original');
  const ids = fh.list(f).versions.map((v) => v.id + ':' + v.tool);
  assert.deepEqual(ids, ['3:restore-pre', '2:write_file', '1:write_file']);
  fh.restore(f, '3'); // undo the rollback itself
  assert.equal(fs.readFileSync(f, 'utf8'), 'mutated');
});

test('T54 tampered snapshot bytes fail the sha256 check and leave the file untouched', () => {
  const { fh, file, tmp } = setup();
  const f = file('e.txt');
  fs.writeFileSync(f, 'good'); fh.record(f, { sessionId: 's1' });
  fs.writeFileSync(f, 'current');
  const bin = path.join(tmp, 'filehistory',
    crypto.createHash('sha256').update(path.resolve(f)).digest('hex').slice(0, 32), '1.bin');
  fs.writeFileSync(bin, 'EVIL');
  assert.throws(() => fh.restore(f, '1'), (e) => e.code === 'checksum_mismatch');
  assert.equal(fs.readFileSync(f, 'utf8'), 'current');
});

test('T54 delete removes one version or the whole file history', () => {
  const { fh, file } = setup();
  const f = file('g.txt');
  fs.writeFileSync(f, 'a'); fh.record(f, { sessionId: 's1' });
  fs.writeFileSync(f, 'b'); fh.record(f, { sessionId: 's1' });
  assert.equal(fh.delete(f, '1').removed, '1');
  assert.deepEqual(fh.list(f).versions.map((v) => v.id), ['2']);
  assert.equal(fh.delete(f).removed, 'all');
  assert.deepEqual(fh.list(f).versions, []);
});

test('T54 diff: line ops with context, binary and too-large are honest values', () => {
  const { fh, file } = setup();
  const f = file('h.txt');
  fs.writeFileSync(f, Buffer.from([0, 1, 2, 3]));
  fh.record(f, { sessionId: 's1' });
  fs.writeFileSync(f, Buffer.from([9, 9]));
  assert.deepEqual(Object.keys(fh.diff(f, '1')), ['ok', 'binary', 'size']);
  const t = file('i.txt');
  fs.writeFileSync(t, 'same\nremoved\n'); fh.record(t, { sessionId: 's1' });
  fs.writeFileSync(t, 'same\nadded\n');
  const d = fh.diff(t, '1');
  assert.deepEqual({ added: d.added, removed: d.removed }, { added: 1, removed: 1 });
  assert.deepEqual(d.lines, [{ type: 'del', text: 'added' }, { type: 'add', text: 'removed' }]);
  // 600x600 distinct lines: 360000 > the 250k-cell cap → counts only
  const big = file('j.txt');
  fs.writeFileSync(big, Array.from({ length: 600 }, (_, i) => 'old' + i).join('\n'));
  fh.record(big, { sessionId: 's1' });
  fs.writeFileSync(big, Array.from({ length: 600 }, (_, i) => 'new' + i).join('\n'));
  const bd = fh.diff(big, '1');
  assert.equal(bd.tooLarge, true); assert.deepEqual({ added: bd.added, removed: bd.removed }, { added: 600, removed: 600 });
});

test('T54 unsafe paths are rejected before any filesystem access', () => {
  assert.throws(() => assertLocalPath('relative.txt'), (e) => e.code === 'unsafe_path');
  assert.throws(() => assertLocalPath('\\\\server\\share\\a'), (e) => e.code === 'unsafe_path');
  assert.throws(() => assertLocalPath('C:\\dir\\file:stream'), (e) => e.code === 'unsafe_path');
  const { fh } = setup();
  assert.deepEqual(fh.record('no-such-relative.txt'), { ok: false, reason: 'unsafe_path' });
});

test('T54 fileHistory.enable=false records nothing; restore still serves old snapshots', () => {
  const off = setup({ enable: false });
  fs.writeFileSync(off.file('k2.txt'), 'x');
  assert.deepEqual(off.fh.record(off.file('k2.txt')), { ok: false, reason: 'disabled' });
  const { fh, file } = setup();
  const f = file('k.txt');
  fs.writeFileSync(f, 'first'); fh.record(f, { sessionId: 's1' });
  fs.writeFileSync(f, 'second');
  assert.equal(fh.restore(f, '1').ok, true);
  assert.equal(fs.readFileSync(f, 'utf8'), 'first');
});

test('T54 api gate: restore/delete require an in-workspace target of an existing session', () => {
  // the sandbox TEMP rule allows everything under os.tmpdir(), so the
  // "outside" file must live in the real home dir (fail-safe denies writes
  // outside the workspace there); cleaned up right after
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-ws-'));
  const inside = path.join(ws, 'in.txt');
  const outside = path.join(os.homedir(), 'myagent-t54-outside-' + Date.now() + '.txt');
  fs.writeFileSync(inside, 'v1'); fs.writeFileSync(outside, 'v1');
  try {
    const { fh } = setup();
    fh.record(inside, { sessionId: 's1' });
    fh.record(outside, { sessionId: 's1' });
    const store = { getSession: (id) => (id === 's1' ? { id: 's1', cwd: ws } : null) };
    const api = createFileHistoryApi({ fileHistory: fh, store, SandboxCtor: Sandbox, defaultRulesFn: defaultRules });
    assert.throws(() => api.restore({ path: outside, sessionId: 's1', versionId: '1' }), (e) => e.code === 'sandbox_denied');
    assert.throws(() => api.restore({ path: inside, sessionId: 'nope', versionId: '1' }), (e) => e.code === 'no_session');
    assert.throws(() => api.delete({ path: outside, sessionId: 's1' }), (e) => e.code === 'sandbox_denied');
    fs.writeFileSync(inside, 'v2');
    assert.equal(api.restore({ path: inside, sessionId: 's1', versionId: '1' }).ok, true);
    assert.equal(fs.readFileSync(inside, 'utf8'), 'v1');
  } finally {
    try { fs.unlinkSync(outside); } catch (_) {}
  }
});

test('T54 diffLines collapses long unchanged runs between two changes', () => {
  // prefix/suffix trimming removes shared head/tail, so a "gap" only appears
  // between TWO changes separated by unchanged lines
  const head = Array.from({ length: 10 }, (_, i) => 'head' + i);
  const tail = Array.from({ length: 10 }, (_, i) => 'tail' + i);
  const mid = Array.from({ length: 30 }, (_, i) => 'mid' + i);
  const old = [...head, 'M1', ...mid, 'M2', ...tail];
  const next = old.slice();
  next[10] = 'X1'; next[41] = 'X2';
  const d = diffLines(old.join('\n'), next.join('\n'));
  assert.deepEqual({ added: d.added, removed: d.removed }, { added: 2, removed: 2 });
  assert.equal(d.lines.some((l) => l.type === 'gap'), true);
  assert.deepEqual(d.lines.filter((l) => l.type === 'del' || l.type === 'add').map((l) => l.type + l.text),
    ['delM1', 'addX1', 'delM2', 'addX2']);
  assert.deepEqual(diffLines('a\n', 'a\n'), { lines: [], added: 0, removed: 0 });
});
