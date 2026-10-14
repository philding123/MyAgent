'use strict';
// T05: prewarm pool semantics (probe model of EngineHost pool logic).
const test = require('node:test');
const assert = require('node:assert');
const { PrewarmPoolProbe } = require('../../app/daemon/engine-host');

test('T05 pool maintains one idle when enabled', () => {
  const p = new PrewarmPoolProbe();
  p.setPrewarm(true);
  assert.strictEqual(p.idle, 1);
  const had = p.activate();
  assert.ok(had);
  assert.strictEqual(p.idle, 1, 'replenished after activation');
  assert.ok(p.events.some((e) => e[0] === 'replenish'));
});

test('T05 pool disabled keeps zero', () => {
  const p = new PrewarmPoolProbe();
  p.setPrewarm(false);
  assert.strictEqual(p.idle, 0);
  assert.strictEqual(p.activate(), false);
});

test('T05 unexpected idle exit triggers replenish', () => {
  const p = new PrewarmPoolProbe();
  p.setPrewarm(true);
  assert.strictEqual(p.idle, 1);
  p.onIdleExit(); // prewarmed process died
  assert.strictEqual(p.idle, 1, 'replenished');
});

test('T05 disable drains pool', () => {
  const p = new PrewarmPoolProbe();
  p.setPrewarm(true);
  p.setPrewarm(false);
  assert.strictEqual(p.idle, 0);
});
