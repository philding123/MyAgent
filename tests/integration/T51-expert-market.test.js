'use strict';
// T51 integration: open-source expert catalog over the real daemon RPC —
// list/read/import land as presets with provenance, experts.builtin=false
// gates the catalog, unknown ids fail closed.
const test = require('node:test');
const assert = require('node:assert');
const { makeTempHome, forkDaemon } = require('../helpers');

test('T51 expert catalog RPC: browse, read, import-as-preset, gating', { timeout: 30000 }, async (t) => {
  const d = forkDaemon(makeTempHome('t51'));
  t.after(() => d.child.kill());
  await d.waitEvent((m) => m.topic === 'daemon:ready', 15000);

  const ls = await d.request('experts.list', {});
  assert.strictEqual(ls.ok, true);
  assert.ok(ls.result.catalog, 'catalog present');
  assert.ok(ls.result.experts.length >= 20, 'curated set exposed, got ' + ls.result.experts.length);
  assert.ok(ls.result.experts.every((e) => typeof e.installed === 'boolean' && e.division_zh));

  const target = ls.result.experts.find((e) => e.id === 'engineering-backend-architect');
  const read = await d.request('experts.read', { id: target.id });
  assert.strictEqual(read.ok, true);
  assert.ok(read.result.prompt.length > 400 && read.result.commit, 'persona + provenance over RPC');

  const imp = await d.request('experts.import', { id: target.id });
  assert.strictEqual(imp.result.status, 'installed');
  const presets = await d.request('presets.list', {});
  const mine = presets.result.find((p) => p.meta && p.meta.source === 'builtin:agency-experts/' + target.id);
  assert.ok(mine, 'imported preset carries its source');
  assert.equal(mine.prompt, read.result.prompt);
  const again = await d.request('experts.import', { id: target.id });
  assert.strictEqual(again.result.status, 'already_installed');
  assert.strictEqual(again.result.presetId, mine.id);
  const after = await d.request('experts.list', {});
  assert.strictEqual(after.result.experts.find((e) => e.id === target.id).installed, true);

  const bad = await d.request('experts.import', { id: 'not-an-expert' });
  assert.strictEqual(bad.ok, true, 'refusal is a value, like market install');
  assert.strictEqual(bad.result.status, 'refused');
  assert.match(bad.result.reason, /unknown expert/);
  assert.strictEqual((await d.request('presets.list', {})).result.length, 1, 'refusal created nothing');

  await d.request('settings.set', { key: 'experts.builtin', value: false });
  const off = await d.request('experts.list', {});
  assert.strictEqual(off.result.catalog, null);
  assert.strictEqual(off.result.experts.length, 0, 'experts.builtin=false hides the catalog');
  const refused = await d.request('experts.import', { id: target.id });
  assert.strictEqual(refused.result.status, 'refused');
});
