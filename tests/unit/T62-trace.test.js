'use strict';
// T62 (F66 execution trace, design/46): the append-only hash-chained trace
// store — tamper detection, secret redaction, truncation marks, the size cap,
// artifact → turn lookup and the Markdown audit export.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTraceStore, hashFile, canonical, GENESIS } = require('../../app/daemon/trace');

function tmpStore(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t62-'));
  let t = 1_700_000_000_000;
  return createTraceStore({ dir, now: () => (t += 1000), ...opts });
}

function oneTurn(tr, sid) {
  tr.beginTurn(sid, { source: 'user', prompt: 'write the report', mode: 'craft' });
  tr.append(sid, { kind: 'llm_step', step: 1, ms: 120, tokens: 40, toolCalls: 1 });
  tr.append(sid, { kind: 'tool_call', id: 'c1', name: 'write_file', toolKind: 'write', args: '{"path":"/w/r.md"}' });
  tr.append(sid, { kind: 'tool_result', id: 'c1', name: 'write_file', ok: true, ms: 5, policy: 'allow', summary: 'written',
    artifact: { path: '/w/r.md', sha256: 'ab'.repeat(32), size: 10 } });
  tr.append(sid, { kind: 'turn_end', reason: 'complete', ms: 300, reply: 'done', artifacts: ['/w/r.md'] });
}

test('T62 records chain from genesis and verify accepts an untouched log', () => {
  const tr = tmpStore();
  oneTurn(tr, 's1');
  const recs = tr.read('s1');
  assert.equal(recs.length, 5);
  assert.equal(recs[0].prev, GENESIS);
  for (let i = 1; i < recs.length; i++) assert.equal(recs[i].prev, recs[i - 1].hash, 'each record links its predecessor');
  assert.deepEqual(recs.map((r) => r.seq), [1, 2, 3, 4, 5]);
  assert.ok(recs.every((r) => r.turn === 1));
  assert.deepEqual(tr.verify('s1'), { ok: true, count: 5 });
});

test('T62 verify detects an edited, a deleted and an inserted line', () => {
  const tr = tmpStore();
  oneTurn(tr, 'edit'); oneTurn(tr, 'del'); oneTurn(tr, 'ins');
  const lines = (sid) => fs.readFileSync(tr._fileFor(sid), 'utf8').trim().split('\n');
  const put = (sid, ls) => fs.writeFileSync(tr._fileFor(sid), ls.join('\n') + '\n');

  const e = lines('edit'); const r = JSON.parse(e[2]); r.args = '{"path":"/w/innocent.md"}'; e[2] = JSON.stringify(r); put('edit', e);
  assert.deepEqual(tr.verify('edit'), { ok: false, count: 5, brokenAt: 3 });

  const d = lines('del'); d.splice(1, 1); put('del', d);
  assert.equal(tr.verify('del').brokenAt, 2);

  const i = lines('ins'); i.splice(2, 0, i[1]); put('ins', i);
  assert.equal(tr.verify('ins').ok, false);
});

test('T62 vault secrets and token shapes never reach the log', () => {
  const tr = tmpStore({ secrets: () => ['my-very-secret-vault-value'] });
  tr.beginTurn('s', { source: 'user', prompt: 'use key my-very-secret-vault-value and sk-abcdefghijklmnop1234' });
  tr.append('s', { kind: 'tool_call', id: 'c', name: 'run_command', toolKind: 'exec',
    args: JSON.stringify({ command: 'curl -H "Authorization: Bearer abcdef1234567890xyz" -H x:ghp_ABCDEFGHIJKLMNOPQRSTUVWX' }) });
  const raw = fs.readFileSync(tr._fileFor('s'), 'utf8');
  for (const leak of ['my-very-secret-vault-value', 'sk-abcdefghijklmnop1234', 'abcdef1234567890xyz', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWX']) {
    assert.ok(!raw.includes(leak), 'leaked ' + leak);
  }
  assert.ok(raw.includes('[REDACTED]'));
  assert.equal(tr.verify('s').ok, true, 'redaction happens before hashing');
});

test('T62 clip marks truncation and the size cap writes one limit record then stops', () => {
  const tr = tmpStore({ maxBytes: 2000 });
  assert.deepEqual(tr.clip('abcdef', 3), { text: 'abc', truncated: true });
  assert.deepEqual(tr.clip('ab', 3), { text: 'ab', truncated: false });
  tr.beginTurn('big', { source: 'user', prompt: 'x' });
  for (let i = 0; i < 20; i++) tr.append('big', { kind: 'tool_call', id: 'c' + i, name: 'read_file', toolKind: 'read', args: 'y'.repeat(200) });
  const recs = tr.read('big');
  assert.equal(recs.filter((r) => r.kind === 'limit').length, 1, 'exactly one limit marker');
  assert.equal(recs.at(-1).kind, 'limit', 'nothing appended after the cap');
  assert.equal(tr.verify('big').ok, true);
});

test('T62 turns number per session, survive a reopened store, and forArtifact picks the latest delivery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t62-'));
  const a = createTraceStore({ dir });
  oneTurn(a, 's'); oneTurn(a, 's');
  const b = createTraceStore({ dir }); // daemon restart: head reloaded from disk
  b.beginTurn('s', { source: 'schedule', prompt: 'again' });
  b.append('s', { kind: 'turn_end', reason: 'complete', ms: 1, reply: '', artifacts: [] });
  const list = b.list('s');
  assert.deepEqual(list.map((x) => x.turn), [1, 2, 3]);
  assert.equal(list[2].source, 'schedule');
  assert.deepEqual(list[0].artifacts, ['/w/r.md']);
  assert.equal(list[0].tools, 1);
  const hit = b.forArtifact('s', '/w/r.md');
  assert.equal(hit.turn, 2, 'most recent turn that delivered the path');
  assert.ok(hit.records.every((r) => r.turn === 2));
  assert.deepEqual(b.forArtifact('s', '/nope'), { turn: null, records: [] });
  assert.equal(b.verify('s').ok, true, 'the chain continues across restarts');
});

test('T62 Markdown export lists steps, artifact hashes and the chain verdict; JSON export is raw', () => {
  const tr = tmpStore();
  oneTurn(tr, 's');
  const md = tr.exportReport('s', { turn: 1, title: '周报' });
  assert.match(md.filename, /^myagent-trace-s-turn1-.*\.md$/);
  assert.ok(md.content.includes('哈希链：✓ 完整'));
  assert.ok(md.content.includes('write_file'));
  assert.ok(md.content.includes('sha256=' + 'ab'.repeat(32)));
  const js = JSON.parse(tr.exportReport('s', { format: 'json' }).content);
  assert.equal(js.records.length, 5);
  assert.equal(js.verify.ok, true);
});

test('T62 remove deletes a session trace; odd session ids stay inside the trace dir', () => {
  const tr = tmpStore();
  oneTurn(tr, 's');
  tr.remove('s');
  assert.deepEqual(tr.read('s'), []);
  const p = tr._fileFor('../../etc/passwd');
  assert.ok(!p.includes('..') && path.basename(p).startsWith('h'), p);
});

test('T62 hashFile fingerprints bytes and reports missing/oversize honestly; canonical JSON is key-order free', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t62-')), 'a.txt');
  fs.writeFileSync(f, 'hello');
  assert.equal(hashFile(f).sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(hashFile(f, 2).skipped, 'too_large');
  assert.equal(hashFile(f + '.x').skipped, 'missing');
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
});
