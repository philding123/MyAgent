'use strict';
// T33-T37 (Phase 8, design/34): spaces, scheduled tasks, presets, library
// tools, @-context augmentation.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../../app/daemon/store');
const { createScheduler } = require('../../app/daemon/tasks');
const { createPresetStore } = require('../../app/daemon/presets');
const { augmentContext } = require('../../app/daemon/context');
const { makeTools } = require('../../app/engine/tools');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'phase8-')); }

test('T33 space field persists and groups sessions', () => {
  const home = tmp();
  const { store } = openStore(path.join(home, 'data'));
  const a = store.createSession({ title: 'a', space: '调研' });
  const b = store.createSession({ title: 'b', cwd: path.join(home, 'ws') });
  assert.equal(store.getSession(a.id).space, '调研');
  store.updateSession(a.id, { space: '' });
  assert.equal(store.getSession(a.id).space, '');
  assert.ok(store.getSession(b.id).cwd);
});

test('T34 scheduler fires on interval and honors remove', async () => {
  const home = tmp();
  const { store } = openStore(path.join(home, 'data'));
  const calls = [];
  const sched = createScheduler({
    store,
    tickMs: 25,
    runSchedule: async (t) => { calls.push(t.name); },
  });
  sched.create({ name: 'job', prompt: 'p', intervalMs: 60 });
  sched.start();
  await new Promise((r) => setTimeout(r, 250));
  sched.stop();
  assert.ok(calls.filter((n) => n === 'job').length >= 2, 'should have fired multiple times');
  const before = calls.length;
  sched.remove(sched.list()[0].id);
  sched.start();
  await new Promise((r) => setTimeout(r, 120));
  sched.stop();
  assert.equal(calls.length, before, 'removed schedule must not fire');
});

test('T34 scheduler disabled schedule does not fire', async () => {
  const home = tmp();
  const { store } = openStore(path.join(home, 'data'));
  const calls = [];
  const sched = createScheduler({ store, tickMs: 25, runSchedule: async (t) => calls.push(t.name) });
  const t = sched.create({ name: 'x', prompt: 'p', intervalMs: 40 });
  sched.toggle(t.id, false);
  sched.start();
  await new Promise((r) => setTimeout(r, 120));
  sched.stop();
  assert.equal(calls.length, 0);
});

test('T35 preset store CRUD', () => {
  const dir = tmp();
  const presets = createPresetStore(dir);
  const p = presets.create({ name: '写作者', description: '文案助理', prompt: '你是资深编辑' });
  assert.ok(p.id);
  assert.equal(presets.list().length, 1);
  assert.equal(presets.read(p.id).prompt, '你是资深编辑');
  assert.equal(presets.read('nope'), null);
  presets.remove(p.id);
  assert.equal(presets.list().length, 0);
});

test('T36 library tools list and read inside the library dir', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.md'), '# library notes');
  const { tools } = makeTools({ library: { dir } });
  const list = await tools.library_list.run({});
  assert.ok(list.data.entries[0].startsWith('notes.md'));
  const read = await tools.library_read.run({ name: 'notes.md' });
  assert.ok(read.data.content.includes('library notes'));
  const sneaky = await tools.library_read.run({ name: '..\\..\\secret.txt' });
  assert.equal(sneaky.ok, false, 'path escape must not resolve');
});

test('T37 augmentContext inlines files and keeps unreadable notes', () => {
  const dir = tmp();
  const file = path.join(dir, 'ctx.txt');
  fs.writeFileSync(file, 'CONTEXT-BODY');
  const big = path.join(dir, 'big.txt');
  fs.writeFileSync(big, 'x'.repeat(65 * 1024));

  const r1 = augmentContext('请总结 @"' + file + '" 谢谢', []);
  assert.ok(r1.text.includes('CONTEXT-BODY'));
  assert.ok(!r1.text.includes('@\"'));
  assert.deepEqual(r1.used, [file]);

  const r2 = augmentContext('看这个', [big]);
  assert.ok(r2.text.includes('过大'));
  assert.equal(r2.used.length, 0);

  const r3 = augmentContext('plain text with @email no tokens', []);
  assert.equal(r3.text, 'plain text with @email no tokens');
});
