'use strict';
// T03: storage adapters — same DAO cases across sqlite/json implementations.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonStore, SqliteStore } = require('../../app/daemon/store');

function casesFor(makeStore) {
  const store = makeStore();
  const s = store.createSession({ title: 'T03', mode: 'ask', cwd: os.tmpdir() });
  assert.ok(s.id);
  assert.strictEqual(store.getSession(s.id).title, 'T03');
  store.appendMessage({ session_id: s.id, role: 'user', content: 'hello marker' });
  store.appendMessage({ session_id: s.id, role: 'assistant', content: 'reply' });
  assert.strictEqual(store.listMessages(s.id).length, 2);
  assert.ok(store.searchMessages('marker').some((m) => m.content.includes('marker')));
  store.updateSession(s.id, { title: 'T03b' });
  assert.strictEqual(store.getSession(s.id).title, 'T03b');
  store.setSetting('k1', { a: 1 });
  assert.deepStrictEqual(store.getSetting('k1'), { a: 1 });
  const mem = store.addMemory('preference', 'concise answers');
  assert.ok(store.listMemory('preference').some((m) => m.content === 'concise answers'));
  store.deleteMemory(mem.id);
  assert.strictEqual(store.listMemory('preference').length, 0);
  store.log('info', 'test', 'line');
  store.checkpoint();
  store.deleteSession(s.id);
  assert.strictEqual(store.listMessages(s.id).length, 0);
  store.close && store.close();
}

test('T03 json store DAO cases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t03-json-'));
  casesFor(() => new JsonStore(path.join(dir, 'store.json')));
});

test('T03 sqlite store DAO cases', { skip: !(() => { try { require('better-sqlite3'); return true; } catch (_) { return false; } })() },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t03-sql-'));
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');
    casesFor(() => new SqliteStore(Database, path.join(dir, 'db.sqlite')));
  });

test('T03 json store corrupt recovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t03-corrupt-'));
  const file = path.join(dir, 'store.json');
  fs.writeFileSync(file, '{not json');
  const st = new JsonStore(file);
  assert.strictEqual(st.recovered, true);
  assert.strictEqual(st.health().ok, true);
  const backups = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.strictEqual(backups.length, 1, 'corrupt file backed up');
});

test('T03 sqlite store corrupt recovery', { skip: !(() => { try { require('better-sqlite3'); return true; } catch (_) { return false; } })() },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t03-scorrupt-'));
    const file = path.join(dir, 'db.sqlite');
    fs.writeFileSync(file, 'this is not a database'.repeat(50));
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');
    const st = new SqliteStore(Database, file);
    assert.strictEqual(st.recovered, true);
    assert.strictEqual(st.health().ok, true);
  });
