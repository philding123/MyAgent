'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonStore, SqliteStore } = require('../../app/daemon/store');
const { normalizeArtifact, collectArtifacts, isSafeOpenPath } = require('../../app/shared/artifacts');
const { createArtifactRegistry } = require('../../app/daemon/artifacts');
const { Sandbox, defaultRules } = require('../../app/daemon/sandbox');
const { makeTools } = require('../../app/engine/tools');
let Database;
try { Database = require('better-sqlite3'); new Database(':memory:').close(); } catch (_) { Database = null; }
const artifact = (p, extra = {}) => ({ schemaVersion: 1, sessionId: 's1', toolCallId: 'call',
  path: p, name: 'ignored', sourceTool: 'write_file', createdAt: 123, kind: 'working', location: 'local', ...extra });
const message = (a, extra = {}) => ({ id: 'm1', role: 'tool', session_id: 's1', tool_name: a.sourceTool,
  tool_json: JSON.stringify({ ok: true, detail: 'retained', artifact: a }), created_at: 123, ...extra });

test('T50 shared normalization, tolerant replay and path-only deduplication', () => {
  const a = artifact('/tmp/a.txt');
  assert.equal(normalizeArtifact(a).name, 'a.txt');
  assert.equal(normalizeArtifact({ ...a, schemaVersion: 2 }), null);
  assert.equal(normalizeArtifact({ ...a, location: 'unknown' }), null);
  assert.equal(normalizeArtifact({ ...a, path: 'bad\u0000.txt' }), null);
  const rows = [message(a), message(a, { tool_json: '{bad' }), message(a, { tool_json: '{"ok":true}' }),
    message(a, { tool_json: JSON.stringify({ ok: false, artifact: a }) }),
    message(artifact('/else/a.txt')), message({ ...a, toolCallId: 'latest' }),
    message(artifact('/wrong.txt', { sessionId: 's2' }))];
  const list = collectArtifacts(rows, 's1');
  assert.equal(list.length, 2);
  assert.equal(list[0].toolCallId, 'latest');
  assert.equal(collectArtifacts(rows, 's2').length, 0);
  for (const p of ['a.html', 'a.svg', 'a.js', 'a.py', 'a.ts', 'a.lnk', 'a.url', 'a.exe', 'a.cmd', 'a.ps1', 'a.xlsm', 'a.doc', 'a.xls', 'a.ppt', 'a.xml', 'a.css', 'a.yaml', '\\\\host\\a.txt', 'C:\\a.txt:evil']) {
    assert.equal(isSafeOpenPath(p), false, p);
  }
  for (const p of ['a.docx', 'a.pdf', 'a.png', 'a.md', 'a.txt', 'a.xlsx', 'a.csv']) assert.equal(isSafeOpenPath(p), true, p);
});

for (const mode of ['json', 'sqlite']) test('T50 ' + mode + ' persisted registry, restart and fail-closed resolution',
  { skip: mode === 'sqlite' && !Database }, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t50-reg-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, mode === 'json' ? 'store.json' : 'store.db');
    const open = () => mode === 'json' ? new JsonStore(file) : new SqliteStore(Database, file);
    let store = open();
    store.createSession({ id: 's1', cwd: root }); store.createSession({ id: 's2', cwd: root });
    const target = path.join(root, 'a.txt'); fs.writeFileSync(target, 'hello');
    const reg = createArtifactRegistry(store);
    store.appendMessage(message(artifact(target)));
    store.appendMessage(message(artifact(target), { id: 'm2' }));
    assert.equal(reg.list({ sessionId: 's1' }).length, 1);
    assert.deepEqual(reg.resolve({ sessionId: 's1', path: target, operation: 'copy' }),
      { path: fs.realpathSync(target), name: 'a.txt' });
    assert.throws(() => reg.resolve({ sessionId: 's2', path: target, operation: 'preview' }), { code: 'not_artifact' });
    assert.throws(() => reg.resolve({ sessionId: 's1', path: target, operation: 'execute' }), { code: 'invalid_params' });
    const remote = path.join(root, 'remote.txt');
    store.appendMessage(message(artifact(remote, { location: 'remote' }), { id: 'remote' }));
    assert.throws(() => reg.resolve({ sessionId: 's1', path: remote, operation: 'reveal' }), { code: 'remote_artifact' });
    const unsafe = path.join(root, 'unsafe.html'); fs.writeFileSync(unsafe, '<script>evil</script>');
    store.appendMessage(message(artifact(unsafe), { id: 'unsafe' }));
    assert.throws(() => reg.resolve({ sessionId: 's1', path: unsafe, operation: 'open' }), { code: 'unsafe_type' });
    assert.equal(reg.resolve({ sessionId: 's1', path: unsafe, operation: 'preview' }).name, 'unsafe.html');
    const secret = path.join(os.homedir(), '.ssh', 'private.txt');
    store.appendMessage(message(artifact(secret), { id: 'secret' }));
    assert.throws(() => reg.resolve({ sessionId: 's1', path: secret, operation: 'copy' }), { code: 'sandbox_denied' });
    store.appendMessage(message(artifact(root), { id: 'dir' }));
    assert.throws(() => reg.resolve({ sessionId: 's1', path: root, operation: 'copy' }), { code: 'not_file' });
    store.close(); store = open();
    const reopened = createArtifactRegistry(store);
    assert.equal(reopened.list({ sessionId: 's1' }).length, 5);
    fs.unlinkSync(target);
    assert.throws(() => reopened.resolve({ sessionId: 's1', path: target, operation: 'copy' }), { code: 'not_found' });
    store.deleteSession('s1');
    assert.throws(() => reopened.list({ sessionId: 's1' }), { code: 'no_session' });
    assert.equal(fs.existsSync(unsafe), true, 'session deletion never deletes deliverables');
    store.close();
  });

test('T50 realpath sandbox and resolved extension reject link swaps', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t50-links-'));
  const prev = process.env.MYAGENT_HOME;
  process.env.MYAGENT_HOME = path.join(root, 'private');
  fs.mkdirSync(process.env.MYAGENT_HOME);
  const secret = path.join(process.env.MYAGENT_HOME, 'secret.txt'); fs.writeFileSync(secret, 'secret');
  const link = path.join(root, 'link.txt');
  t.after(() => { if (prev === undefined) delete process.env.MYAGENT_HOME; else process.env.MYAGENT_HOME = prev; fs.rmSync(root, { recursive: true, force: true }); });
  try { fs.symlinkSync(secret, link); } catch (e) { if (e.code === 'EPERM') return t.skip('Windows symlink privilege unavailable'); throw e; }
  const store = new JsonStore(path.join(root, 'db.json'));
  store.createSession({ id: 's1', cwd: root }); store.appendMessage(message(artifact(link)));
  const reg = createArtifactRegistry(store);
  assert.throws(() => reg.resolve({ sessionId: 's1', path: link, operation: 'copy' }), { code: 'sandbox_denied' });
  const script = path.join(root, 'evil.js'); fs.writeFileSync(script, 'evil');
  fs.unlinkSync(link); fs.symlinkSync(script, link);
  assert.throws(() => reg.resolve({ sessionId: 's1', path: link, operation: 'open' }), { code: 'unsafe_type' });
  store.close();
});

test('T50 write results declare local versus cloud; remote present never copies a local namesake', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t50-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sandbox = new Sandbox(defaultRules(root), { workspace: root });
  const target = path.join(root, 'a.txt');
  const local = makeTools({ sandbox }).tools;
  assert.deepEqual((await local.write_file.run({ path: target, content: 'x' })).data, { path: target, location: 'local' });
  const cloud = makeTools({ sandbox, cloud: { write: async () => {} } }).tools;
  assert.deepEqual((await cloud.write_file.run({ path: target, content: 'x' })).data, { path: target, location: 'remote' });
  assert.equal((await cloud.present_file.run({ path: target })).ok, false);
  const failing = makeTools({ sandbox, cloud: { write: async () => { throw new Error('offline'); } } }).tools;
  const result = await failing.write_file.run({ path: target, content: 'x' });
  assert.equal(result.ok, false); assert.equal(result.data, undefined);
});
