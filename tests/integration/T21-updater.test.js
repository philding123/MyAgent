'use strict';
// T21b: updater full chain against a local manifest+artifact HTTP source.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const { Updater } = require('../../app/main/updater');

function serve() {
  const routes = {};
  const server = http.createServer((req, res) => {
    const r = routes[req.url];
    if (!r) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(typeof r === 'string' || Buffer.isBuffer(r) ? r : JSON.stringify(r));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, routes, base: 'http://127.0.0.1:' + server.address().port }));
  });
}

test('T21b check→download→verify→ready with progress stages', { timeout: 30000 }, async (t) => {
  const payload = Buffer.from('fake-update-body');
  const sha = crypto.createHash('sha256').update(payload).digest('hex');
  const { server, routes, base } = await serve();
  routes['/manifest.json'] = { version: '9.9.9', url: base + '/update.bin', sha256: sha, notes: 'test' };
  routes['/update.bin'] = payload;
  t.after(() => server.close());
  const stages = [];
  const u = new Updater({ manifestUrl: base + '/manifest.json', currentVersion: '0.1.0',
    emit: (_stage, p) => stages.push(p.stage) });
  const chk = await u.check();
  assert.strictEqual(chk.ok, true);
  assert.strictEqual(chk.updateAvailable, true);
  assert.strictEqual(chk.version, '9.9.9');
  const dl = await u.download();
  assert.strictEqual(dl.ok, true, 'download+verify ok: ' + JSON.stringify(dl));
  assert.strictEqual(u.state.stage, 'ready');
  assert.ok(stages.includes('check') && stages.includes('download') && stages.includes('verify') && stages.includes('ready'));
  assert.ok(u.state.downloadedFile.endsWith('update.bin'));
  // same-version manifest -> no update available
  u.currentVersion = '9.9.9';
  const chk3 = await u.check();
  assert.strictEqual(chk3.updateAvailable, false);
});

test('T21b corrupt artifact is refused and cleaned', { timeout: 30000 }, async (t) => {
  const { server, routes, base } = await serve();
  routes['/manifest.json'] = { version: '9.9.9', url: base + '/update.bin', sha256: 'ab'.repeat(32) };
  routes['/update.bin'] = Buffer.from('tampered');
  t.after(() => server.close());
  const u = new Updater({ manifestUrl: base + '/manifest.json', currentVersion: '0.1.0' });
  await u.check();
  const dl = await u.download();
  assert.strictEqual(dl.ok, false);
  assert.strictEqual(u.state.lastError.includes('sha256 mismatch'), true);
  assert.strictEqual(u.state.downloadedFile, null);
});

test('T21b unavailable source -> disabled/error states', { timeout: 30000 }, async (t) => {
  const u1 = new Updater({ manifestUrl: '', currentVersion: '0.1.0' });
  const r1 = await u1.check();
  assert.strictEqual(r1.reason, 'disabled');
  const u2 = new Updater({ manifestUrl: 'http://127.0.0.1:1/none.json', currentVersion: '0.1.0' });
  const r2 = await u2.check();
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(u2.state.stage, 'error');
  assert.ok(u2.status().currentVersion);
});
