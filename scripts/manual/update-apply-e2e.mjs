#!/usr/bin/env node
// F21 manual-item runner (design/99-test-plan.md 手工清单 #8): full
// check→download→verify→apply→swap→relaunch cycle against a throwaway
// "installed app" directory. Safe to re-run; never touches the repo install.
//
// The fake app is MyAgent.exe = a copy of mshta.exe (GUI subsystem: starts,
// exits, no window). The transition window closes via its short timeouts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { Updater } from '../../app/main/updater.js';

const results = [];
const step = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? null });
  console.log(`[${ok ? 'ok' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-upd-e2e-'));
const appRoot = path.join(root, 'app');
fs.mkdirSync(appRoot, { recursive: true });
// "installed" old build
fs.writeFileSync(path.join(appRoot, 'VERSION.txt'), '0.1.0');
fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'mshta.exe'),
  path.join(appRoot, 'MyAgent.exe'));

// new build zip (v0.2.0: marker file + new VERSION)
const stage = path.join(root, 'newbuild');
fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, 'VERSION.txt'), '0.2.0');
fs.writeFileSync(path.join(stage, 'new-feature.txt'), 'shipped by update');
const zipPath = path.join(root, 'myagent-0.2.0.zip');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`], { timeout: 120000 });
const sha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');

// local update source
let port;
const server = http.createServer((req, res) => {
  if (req.url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: '0.2.0', url: `http://127.0.0.1:${port}/myagent-0.2.0.zip`, sha256: sha, notes: 'e2e' }));
  } else if (req.url === '/myagent-0.2.0.zip') {
    res.writeHead(200); res.end(fs.readFileSync(zipPath));
  } else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
port = server.address().port;

const u = new Updater({
  manifestUrl: `http://127.0.0.1:${port}/manifest.json`,
  currentVersion: '0.1.0',
});
const chk = await u.check();
step('check: update available', chk.ok && chk.updateAvailable === true && chk.version === '0.2.0', JSON.stringify(chk));

const dl = await u.download();
step('download+verify: ready', dl.ok === true && u.state.stage === 'ready', u.state.downloadedFile || '');

// transition window with short timeouts (it will close on its own guards)
const applied = u.apply({
  appRoot,
  exeName: 'MyAgent.exe',
  quitFn: () => {}, // harness keeps running; real app quits here
  transition: { timeoutSeconds: 8, maxInstallSeconds: 15, detectStartSeconds: 1, fadeMs: 300 },
});
step('apply: accepted', applied.ok === true, JSON.stringify(applied));

// the batch waits for MyAgent.exe to be absent (it never runs), swaps, relaunches
let swapped = false;
for (let i = 0; i < 60 && !swapped; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { swapped = fs.readFileSync(path.join(appRoot, 'VERSION.txt'), 'utf8') === '0.2.0'; } catch (_) {}
}
step('swap: VERSION 0.1.0 → 0.2.0', swapped, swapped ? 'relaunched marker=' + fs.existsSync(path.join(appRoot, 'new-feature.txt')) : 'timeout 30s');

await new Promise((r) => setTimeout(r, 2000));
server.close();
const allOk = results.every((r) => r.ok);
fs.mkdirSync(path.join(root, 'out'), { recursive: true });
const outPath = path.join(root, 'out', 'update-apply-e2e.json');
fs.writeFileSync(outPath, JSON.stringify({ ok: allOk, results }, null, 2));
console.log(allOk ? '\nUPDATE-APPLY E2E: ALL PASS' : '\nUPDATE-APPLY E2E: HAS FAILURES');
console.log('workspace (kept for inspection):', root);
process.exit(allOk ? 0 : 1);
