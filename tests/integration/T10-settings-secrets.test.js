'use strict';
// T10c: every credential a settings panel submits goes to the vault, never
// the settings table — including the cloud sandbox key (found by the button
// audit: it used to be stored in plaintext and never reached the engine).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeTempHome, forkDaemon } = require('../helpers');

test('T10c settings.set routes credential keys into the vault; plaintext from old builds is migrated', { timeout: 30000 }, async (t) => {
  const home = makeTempHome('t10c');
  let d = forkDaemon(home);
  t.after(() => d.child.kill());
  await d.waitEvent((m) => m.topic === 'daemon:ready', 15000);
  for (const [key, value] of [['llm.apiKey', 'sk-T10C-LLM'], ['sandbox.cloud.apiKey', 'e2b-T10C-CLOUD']]) {
    const r = await d.request('settings.set', { key, value });
    assert.strictEqual(r.ok, true);
    const all = (await d.request('settings.all')).result;
    assert.ok(!JSON.stringify(all).includes(value), key + ' plaintext in settings');
    assert.strictEqual(all[key + '.set'], true, key + ' marked as set');
  }
  const vaultRaw = fs.readFileSync(path.join(home, 'keystore', 'vault.bin'), 'utf8');
  assert.ok(vaultRaw.includes('sandbox.cloud.apiKey') && !vaultRaw.includes('e2b-T10C-CLOUD'), 'encrypted vault entry');
  // the change event must not echo secrets to every window
  const ev = d.events.filter((m) => m.topic === 'settings:changed');
  assert.ok(ev.length >= 2 && ev.every((m) => !JSON.stringify(m.payload).includes('T10C')), 'settings:changed leaked a secret');

  // simulate an old build that wrote the key into settings (through the same
  // DAO, whichever store is active), then restart the daemon
  d.child.kill();
  await new Promise((r) => d.child.once('exit', r));
  const { openStore } = require('../../app/daemon/store');
  const { store } = openStore(path.join(home, 'data'));
  store.setSetting('sandbox.cloud.apiKey', 'e2b-OLD-PLAINTEXT');
  store.close();
  d = forkDaemon(home);
  await d.waitEvent((m) => m.topic === 'daemon:ready', 15000);
  const all = (await d.request('settings.all')).result;
  assert.ok(!JSON.stringify(all).includes('e2b-OLD-PLAINTEXT'), 'old plaintext still in settings after migration');
  assert.strictEqual(all['sandbox.cloud.apiKey.set'], true);
  assert.ok(!fs.readFileSync(path.join(home, 'keystore', 'vault.bin'), 'utf8').includes('e2b-OLD-PLAINTEXT'), 'migrated value encrypted');
});
