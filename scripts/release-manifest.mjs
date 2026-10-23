#!/usr/bin/env node
// Release metadata for installers built by electron-builder (design/37):
//   latest.json   — F21 updater manifest {version, url, sha256, notes} for the
//                   Windows NSIS installer (app/main/updater.js runs it with /S)
//   SHA256SUMS.txt — every installer, `sha256sum -c` compatible
//   node scripts/release-manifest.mjs --dir <artifacts> --base-url <download prefix> [--notes "…"]
// The base URL is the GitHub release download prefix, e.g.
//   https://github.com/<owner>/<repo>/releases/download/v0.2.0
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(opt('--dir', path.join(ROOT, 'dist-installer')));
const BASE = String(opt('--base-url', '')).replace(/\/+$/, '');
const NOTES = opt('--notes', '');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const INSTALLER = /\.(exe|AppImage|deb|dmg)$/;
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && !/-unpacked$|^mac/.test(e.name)) walk(p);
    else if (e.isFile() && INSTALLER.test(e.name) && e.name.includes(version)) files.push(p);
  }
})(DIR);
if (!files.length) { console.error(`no installers for version ${version} under ${DIR}`); process.exit(2); }

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sums = files.map((f) => ({ name: path.basename(f), sha256: sha(f), size: fs.statSync(f).size }))
  .sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(DIR, 'SHA256SUMS.txt'), sums.map((s) => `${s.sha256}  ${s.name}`).join('\n') + '\n');

const win = sums.find((s) => s.name.endsWith('.exe'));
if (win) {
  if (!BASE) { console.error('--base-url is required to write latest.json'); process.exit(2); }
  const manifest = { version, url: `${BASE}/${encodeURIComponent(win.name)}`, sha256: win.sha256, size: win.size,
    notes: NOTES, releasedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(DIR, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('latest.json → ' + manifest.url);
} else {
  console.log('no Windows installer: latest.json not written (the F21 updater applies Windows installers only)');
}
for (const s of sums) console.log(`${s.sha256}  ${s.name}  (${(s.size / 1048576).toFixed(1)} MB)`);
