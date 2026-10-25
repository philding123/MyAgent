'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { createArtifactActions, isArtifactSender } = require('../../app/main/artifact-actions');
const target = path.resolve('report.txt');
const req = { sessionId: 's1', path: target, operation: 'open' };
function setup(overrides = {}) {
  const calls = [];
  const run = createArtifactActions({
    request: async (method, p) => { calls.push(['resolve', method, p]); return { ok: true, result: { path: target, name: 'report.txt' } }; },
    shell: { openPath: async (p) => { calls.push(['open', p]); return ''; }, showItemInFolder: (p) => calls.push(['reveal', p]) },
    clipboard: { writeText: (p) => calls.push(['copy', p]) },
    confirmOpen: async () => { calls.push(['confirm']); return true; },
    isTrustedSender: () => true, ...overrides,
  });
  return { calls, run };
}

test('T50 native APIs use resolved paths, open prompts each time, copy/reveal do not prompt', async () => {
  const { calls, run } = setup();
  assert.deepEqual(await run({}, req), { ok: true, path: target });
  assert.deepEqual(await run({}, req), { ok: true, path: target });
  await run({}, { ...req, operation: 'copy' }); await run({}, { ...req, operation: 'reveal' });
  assert.equal(calls.filter((c) => c[0] === 'confirm').length, 2);
  assert.equal(calls.filter((c) => c[0] === 'resolve').length, 6);
  assert.deepEqual(calls.filter((c) => ['open', 'copy', 'reveal'].includes(c[0])),
    [['open', target], ['open', target], ['copy', target], ['reveal', target]]);
});

test('T50 default-app open refuses denied, timeout, unsafe, changed and invalid targets', async () => {
  const denied = setup({ confirmOpen: async () => false });
  assert.equal((await denied.run({}, req)).error.code, 'denied');
  assert.equal(denied.calls.some((c) => c[0] === 'open'), false);
  let aborted = false;
  const timeout = setup({ timeoutMs: 5, confirmOpen: (_t, _e, signal) => new Promise(() => {
    signal.addEventListener('abort', () => { aborted = true; });
  }) });
  assert.equal((await timeout.run({}, req)).error.code, 'denied'); assert.equal(aborted, true);
  for (const p of ['evil.html', 'evil.svg', 'evil.js', 'evil.exe']) {
    const unsafe = setup({ request: async () => ({ ok: true, result: { path: p } }) });
    assert.equal((await unsafe.run({}, req)).error.code, 'unsafe_type'); assert.equal(unsafe.calls.length, 0);
  }
  let n = 0;
  const changed = setup({ request: async () => ({ ok: true, result: { path: ++n === 1 ? target : path.resolve('other.txt') } }) });
  assert.equal((await changed.run({}, req)).error.code, 'artifact_changed');
  const missing = setup({ request: async () => ({ ok: false, error: { code: 'not_found', message: 'missing' } }) });
  assert.equal((await missing.run({}, req)).error.code, 'not_found');
  assert.equal((await setup().run({}, { ...req, operation: 'exec' })).error.code, 'invalid_params');
  assert.equal((await setup({ isTrustedSender: () => false }).run({}, req)).error.code, 'forbidden_sender');
});

test('T50 native failures structured, source rechecked after approval, seams never launch apps', async () => {
  assert.deepEqual(await setup({ shell: { openPath: async () => 'OS refused' } }).run({}, req),
    { ok: false, error: { code: 'native_error', message: 'OS refused' } });
  assert.equal((await setup({ clipboard: { writeText: () => { throw new Error('clipboard offline'); } } })
    .run({}, { ...req, operation: 'copy' })).error.code, 'native_error');
  let trusted = true;
  const changed = setup({ isTrustedSender: () => trusted, confirmOpen: async () => { trusted = false; return true; } });
  assert.equal((await changed.run({}, req)).error.code, 'forbidden_sender');
  const seams = { artifacts: [], responses: [true, false] };
  const { run, calls } = setup({ seams, shell: null, clipboard: null });
  assert.equal((await run({}, req)).ok, true);
  assert.equal((await run({}, req)).error.code, 'denied');
  assert.equal((await run({}, req)).error.code, 'denied');
  assert.equal((await run({}, { ...req, operation: 'copy' })).ok, true);
  assert.equal(calls.some((c) => c[0] === 'confirm'), false);
  assert.deepEqual(seams.artifacts, [{ ...req, path: target }, { ...req, operation: 'copy', path: target }]);
  assert.equal(seams.responses.length, 0);
});

test('T50 sender requires registered main top-level local renderer, never iframe or navigated frame', () => {
  const file = path.resolve('app/renderer/index.html');
  const url = pathToFileURL(file).href;
  const frame = { url };
  const sender = { mainFrame: frame, getURL: () => url };
  const windows = { get: () => ({ isDestroyed: () => false, webContents: sender }) };
  const event = { sender, senderFrame: frame };
  assert.equal(isArtifactSender(event, windows, file), true);
  assert.equal(isArtifactSender({ ...event, senderFrame: { url } }, windows, file), false);
  assert.equal(isArtifactSender({ ...event, sender: { ...sender } }, windows, file), false);
  frame.url = 'https://evil.test/index.html';
  assert.equal(isArtifactSender(event, windows, file), false);
  frame.url = pathToFileURL(path.resolve('app/renderer/preview.html')).href;
  assert.equal(isArtifactSender(event, windows, file), false);
});
