#!/usr/bin/env node
// Electron-side real SQLite (design/14-data.md 附录): better-sqlite3 ships
// Node-ABI prebuilds in node_modules (used by the plain-node test layer) and
// Electron-ABI prebuilds upstream. This script vendors a second copy with the
// Electron ABI into vendor/better-sqlite3-electron/ so the daemon — running
// under Electron's node — can load real SQLite without a compiler.
// Idempotent; uses the npm mirror first (GitHub times out on this network),
// falls back to the default host. Missing vendor dir at runtime = JSON store
// fallback (existing degradation path, selfcheck reports the mode).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'node_modules', 'better-sqlite3');
const DST = path.join(ROOT, 'vendor', 'better-sqlite3-electron');
const MARKER = 'electron-v';

function electronVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')).version; }
  catch (_) { return null; }
}

const ev = electronVersion();
if (!ev) {
  console.log('[electron-sqlite] electron not installed; skipping');
  process.exit(0);
}
const markerFile = path.join(DST, '.abi-electron-' + ev);
if (fs.existsSync(markerFile)) {
  console.log('[electron-sqlite] vendor up to date (electron ' + ev + ')');
  process.exit(0);
}

fs.rmSync(DST, { recursive: true, force: true });
fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.cpSync(SRC, DST, { recursive: true });
// drop the Node-ABI binary; prebuild-install replaces it
fs.rmSync(path.join(DST, 'build', 'Release', 'better_sqlite3.node'), { force: true });

const attempts = [
  { env: { ...process.env, npm_config_better_sqlite3_binary_host_mirror: 'https://npmmirror.com/mirrors/better-sqlite3' } },
  { env: { ...process.env } },
];
let ok = false;
for (const a of attempts) {
  const r = spawnSync('npx', ['--yes', 'prebuild-install', '--runtime', 'electron', '--target', ev],
    { cwd: DST, encoding: 'utf8', timeout: 300000, env: a.env, shell: true });
  if (r.status === 0 && fs.existsSync(path.join(DST, 'build', 'Release', 'better_sqlite3.node'))) { ok = true; break; }
  console.log('[electron-sqlite] prebuild-install attempt failed:', String(r.stderr || r.stdout || '').split('\n').slice(-2).join(' '));
}

if (!ok) {
  fs.rmSync(DST, { recursive: true, force: true });
  console.log('[electron-sqlite] no Electron prebuild available; Electron keeps JSON-store fallback');
  process.exit(0);
}
fs.writeFileSync(markerFile, String(Date.now()));
const size = fs.statSync(path.join(DST, 'build', 'Release', 'better_sqlite3.node')).size;
console.log('[electron-sqlite] vendored Electron-ABI better_sqlite3.node (' + Math.round(size / 1024) + 'KB) for electron ' + ev);
