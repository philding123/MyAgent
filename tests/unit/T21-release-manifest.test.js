'use strict';
// T21c: the release pipeline's manifest (scripts/release-manifest.mjs) is
// exactly what the F21 updater consumes — check → newer version, and the
// downloaded installer passes the updater's own sha256 verify.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Updater } = require('../../app/main/updater');

const ROOT = path.join(__dirname, '..', '..');
const version = require('../../package.json').version;

test('T21c release-manifest output drives the updater end to end', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t21c-'));
  const exe = path.join(dir, `MyAgent-Setup-${version}-x64.exe`);
  fs.writeFileSync(exe, Buffer.from('fake nsis installer ' + version));
  fs.writeFileSync(path.join(dir, `MyAgent-${version}-x86_64.AppImage`), 'appimage');
  fs.writeFileSync(path.join(dir, 'MyAgent-0.0.1-x86_64.AppImage'), 'old version, must be ignored');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'release-manifest.mjs'), '--dir', dir,
    '--base-url', 'https://example.test/releases/download/v' + version + '/', '--notes', 'hello']);

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  assert.strictEqual(manifest.version, version);
  assert.strictEqual(manifest.url, `https://example.test/releases/download/v${version}/MyAgent-Setup-${version}-x64.exe`);
  assert.strictEqual(manifest.notes, 'hello');
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.strictEqual(sums.length, 2, 'only this version\'s installers');
  assert.ok(sums.every((l) => /^[0-9a-f]{64} {2}MyAgent-/.test(l)));

  // feed it to the real updater with an injected fetch serving these files
  const fetchImpl = async (u) => {
    const body = u.endsWith('latest.json') ? fs.readFileSync(path.join(dir, 'latest.json')) : fs.readFileSync(exe);
    return { ok: true, status: 200, text: async () => body.toString('utf8'), arrayBuffer: async () => body };
  };
  const up = new Updater({ manifestUrl: 'https://example.test/latest.json', currentVersion: '0.0.1', fetchImpl });
  const c = await up.check();
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.updateAvailable, true);
  up.tmpDir = path.join(dir, 'dl');
  const d = await up.download();
  assert.strictEqual(d.ok, true, JSON.stringify(d));
  assert.strictEqual(up.status().stage, 'ready');
  // same version is not an update
  const same = new Updater({ manifestUrl: 'https://example.test/latest.json', currentVersion: version, fetchImpl });
  assert.strictEqual((await same.check()).updateAvailable, false);
});
