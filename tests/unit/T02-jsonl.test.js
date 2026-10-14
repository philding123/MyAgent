'use strict';
// T02: JSON-Lines wire codec (engine boundary).
const test = require('node:test');
const assert = require('node:assert');
const { JsonlCodec } = require('../../app/daemon/jsonl');

test('T02 codec roundtrip single frames', () => {
  const c = new JsonlCodec();
  const out = c.push(Buffer.from(JsonlCodec.encode({ type: 'token', text: 'hi' })));
  assert.deepStrictEqual(out, [{ type: 'token', text: 'hi' }]);
});

test('T02 codec splits chunks across pushes', () => {
  const c = new JsonlCodec();
  const wire = JsonlCodec.encode({ a: 1 }) + JsonlCodec.encode({ b: 2 });
  const split = wire.indexOf('{', 1) + 2; // mid-second-frame, guarantees a partial frame
  assert.deepStrictEqual(c.push(Buffer.from(wire.slice(0, split))), [{ a: 1 }]);
  const out = c.push(Buffer.from(wire.slice(split)));
  assert.deepStrictEqual(out, [{ b: 2 }]);
});

test('T02 codec tolerates bad frames', () => {
  const c = new JsonlCodec();
  const out = c.push(Buffer.from('not-json\n' + JsonlCodec.encode({ ok: true })));
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].type, 'error');
  assert.deepStrictEqual(out[1], { ok: true });
});
