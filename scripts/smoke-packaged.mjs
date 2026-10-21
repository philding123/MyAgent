#!/usr/bin/env node
// Run the E2E smoke suite (app/main/index.js runSmoke) against the PACKAGED
// app that electron-builder left in dist-installer/*-unpacked — the same
// binary the installer ships, with the daemon/engine forked from app.asar.
//   node scripts/smoke-packaged.mjs [--dir dist-installer] [--audit]
// --audit also runs the 91-control button audit against that binary.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(opt('--dir', path.join(ROOT, 'dist-installer')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBinary() {
  if (process.platform === 'win32') return path.join(DIR, 'win-unpacked', 'MyAgent.exe');
  if (process.platform === 'darwin') {
    const mac = fs.readdirSync(DIR).find((d) => /^mac/.test(d) && fs.existsSync(path.join(DIR, d, 'MyAgent.app')));
    return mac && path.join(DIR, mac, 'MyAgent.app', 'Contents', 'MacOS', 'MyAgent');
  }
  return path.join(DIR, 'linux-unpacked', 'myagent');
}

const bin = findBinary();
if (!bin || !fs.existsSync(bin)) { console.error('packaged binary not found under ' + DIR); process.exit(2); }
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-pkg-smoke-'));
const out = path.join(home, 'smoke-result.json');
const extra = process.platform === 'linux' && process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : [];
let cmd = bin; let cmdArgs = extra;
if (process.platform === 'linux' && !process.env.DISPLAY) { cmdArgs = ['-a', bin, ...extra]; cmd = 'xvfb-run'; }
console.log('[smoke-packaged] ' + bin);
const child = spawn(cmd, cmdArgs, {
  stdio: 'ignore', detached: process.platform !== 'win32',
  env: { ...process.env, MYAGENT_SMOKE: '1', MYAGENT_SMOKE_OUT: out, MYAGENT_HOME: path.join(home, 'data') },
});
let parsed = null;
for (let i = 0; i < 240 && !parsed; i++) {
  await sleep(1000);
  try { const j = JSON.parse(fs.readFileSync(out, 'utf8')); if ('exitCode' in j) parsed = j; } catch (_) {}
}
// the Electron tree can outlive the result file (Windows) — reap it
if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
else { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {} }
if (!parsed) { console.error('[smoke-packaged] no result within 240s'); process.exit(1); }
for (const s of parsed.steps) if (!s.ok) console.log('FAIL ' + s.name + ' ' + String(s.detail).slice(0, 200));
const store = (parsed.steps.find((s) => s.name === 'selfcheck') || {}).detail;
console.log(`[smoke-packaged] ${parsed.steps.filter((s) => s.ok).length}/${parsed.steps.length} steps ok, store=${store}`);
let code = parsed.exitCode;
// a packaged build that silently fell back to the JSON store means the
// vendored Electron-ABI SQLite did not make it into the package
if (store !== 'sqlite') { console.error('[smoke-packaged] expected store=sqlite in the package, got ' + store); code = 1; }

if (args.includes('--audit') && code === 0) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'button-audit.mjs'), '--exec', bin,
    '--out', path.join(DIR, 'button-audit')], { stdio: 'inherit', timeout: 900000 });
  code = r.status === 0 ? 0 : 1;
}
process.exit(code);
