'use strict';
// T25: cloud skill market over a real loopback HTTP source (index + zip),
// driven through the daemon RPC like the UI/engine would.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { makeTempHome, forkDaemon } = require('../helpers');

function zipDir(srcDir, outZip) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${outZip}' -Force`],
    { timeout: 120000 }, (err) => (err ? reject(err) : resolve()));
  });
}

function makeZipWithSkill(tag, skillName) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't25-' + tag + '-'));
  const skillDir = path.join(tmp, 'pack', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: market fixture skill ${tag}\nallowed-tools: \ndisable: false\n---\n# fixture\n`);
  const zip = path.join(tmp, skillName + '.zip');
  return zipDir(path.join(skillDir, '..'), zip).then(() => zip);
}

test('T25 search/install/already/refused(hash) through daemon RPC', { timeout: 120000 }, async (t) => {
  const zipA = await makeZipWithSkill('a', 'review-helper');
  const shaA = cryptoHash(zipA);
  function cryptoHash(f) {
    return require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  }

  let served = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/index.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'test-market',
        description: 'T25 fixture market',
        plugins: [
          { name: 'review-helper', display_name: 'Review Helper', description: 'reviews your code',
            category: 'skill', version: '1.0.0', source: `http://127.0.0.1:${port}/review-helper.zip`, sha256: shaA },
          { name: 'evil-skill', display_name: 'Evil', description: 'tampered payload',
            category: 'skill', version: '1.0.0', source: `http://127.0.0.1:${port}/evil.zip`, sha256: 'cd'.repeat(32) },
        ],
      }));
      return;
    }
    if (req.url === '/review-helper.zip') {
      served++;
      res.writeHead(200); res.end(fs.readFileSync(zipA)); return;
    }
    if (req.url === '/evil.zip') {
      res.writeHead(200); res.end(Buffer.from('totally not the hashed content')); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  t.after(() => server.close());

  const home = makeTempHome('t25');
  const d = forkDaemon(home, { MYAGENT_MARKET_INSECURE: undefined });
  t.after(() => d.child.kill());
  await d.waitEvent((m) => m.topic === 'daemon:ready', 15000);
  await d.request('settings.set', { key: 'market.url', value: `http://127.0.0.1:${port}/index.json` });
  // http source needs the explicit insecure allowance (loopback test)
  await d.request('settings.set', { key: 'market.allowInsecure', value: true });

  const st = await d.request('market.status');
  assert.strictEqual(st.ok, true);
  assert.ok(st.result.sources[0].includes('index.json'));

  const hits = await d.request('market.search', { keywords: ['code'] });
  assert.strictEqual(hits.ok, true);
  assert.ok(hits.result.some((s) => s.name === 'review-helper'), 'single keyword hits');
  const hits2 = await d.request('market.search', { keywords: ['review'] });
  assert.ok(hits2.result.some((s) => s.name === 'review-helper'), 'keyword search hits');
  const misses = await d.request('market.search', { keywords: ['quantum'] });
  assert.ok(!misses.result.some((s) => s.name === 'review-helper'), 'non-matching keyword misses');

  const inst = await d.request('market.install', { names: ['review-helper'] });
  assert.strictEqual(inst.result[0].status, 'installed', JSON.stringify(inst.result));

  const skills = await d.request('skills.list');
  assert.ok(skills.result.some((s) => s.name === 'review-helper'), 'installed skill visible');

  const again = await d.request('market.install', { names: ['review-helper'] });
  assert.strictEqual(again.result[0].status, 'already_installed');

  const evil = await d.request('market.install', { names: ['evil-skill'] });
  assert.strictEqual(evil.result[0].status, 'refused');
  assert.ok(evil.result[0].reason.includes('hash_mismatch'), 'sha256 mismatch reason');
  const skillsAfter = await d.request('skills.list');
  assert.ok(!skillsAfter.result.some((s) => s.name === 'evil-skill'), 'tampered skill not installed');

  const missing = await d.request('market.install', { names: ['no-such-skill'] });
  assert.strictEqual(missing.result[0].status, 'refused');
  assert.ok(missing.result[0].reason.includes('not found'));
});
