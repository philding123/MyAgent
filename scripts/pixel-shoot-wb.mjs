#!/usr/bin/env node
// WorkBuddy pixel baseline driver (design/27): shoot the official skeleton
// screens via scripts/electron-shot.js (offscreen-ish Electron window, no
// network need). Invoked exactly like the MyAgent e2e smoke does — routed
// through cmd /c, because GUI-subsystem electron.exe loses stdio and exit
// codes when spawned directly from a POSIX-y shell on Windows. A fresh-file
// AV scan on this machine can make electron.exe die before the script runs,
// so each surface retries up to 3 times and judges by the output PNG.
// Usage: node scripts/pixel-shoot-wb.mjs [wbExtractDir] [outDir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WB = process.argv[2] || path.join(os.tmpdir(), 'wb-extract', 'app', 'renderer');
const OUT = path.resolve(process.argv[3] || 'artifacts/pixel-evidence');
if (!fs.existsSync(path.join(WB, 'index.html'))) {
  console.error(`wb-extract renderer not found at ${WB} — re-extract app.asar first`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const SHOT = path.join(ROOT, 'scripts', 'electron-shot.js');
const SURFACES = [
  // native window sizes: settings 900x680, search 800x640 (main/window-apps.js)
  { name: 'main', q: '', js: false, w: 1280, h: 800 },
  { name: 'settings', q: '?windowKind=settings&colorScheme=light', js: true, w: 900, h: 680 },
  { name: 'search', q: '?windowKind=global-search', js: true, w: 800, h: 640 },
  // image-viewer rides a `utility` preset (no literal size in the bundle);
  // both sides are shot at MyAgent's preview window size 980x720
  { name: 'preview', q: '?windowKind=image-viewer', js: true, w: 980, h: 720 },
  // dark variants (F29 dark token table): settings reads colorScheme via
  // matchMedia when the param is absent; search darks through the
  // prefers-color-scheme media block — both need PIXEL_SHOT_DARK=1
  { name: 'settings-dark', q: '?windowKind=settings', js: true, w: 900, h: 680, dark: true },
  { name: 'search-dark', q: '?windowKind=global-search', js: true, w: 800, h: 640, dark: true },
];

const q = (p) => (/\s/.test(p) ? '"' + p + '"' : p);
for (const s of SURFACES) {
  const url = 'file:///' + path.join(WB, 'index.html').replace(/\\/g, '/') + s.q;
  const png = path.join(OUT, `wb-${s.name}.png`);
  fs.rmSync(png, { force: true });
  fs.rmSync(png + '.log', { force: true });
  fs.rmSync(path.join(ROOT, 'electron-shot-boot.log'), { force: true });
  // parameters travel through env (argv is dropped by some cmd routings)
  const env = {
    ...process.env,
    PIXEL_SHOT_URL: url,
    PIXEL_SHOT_W: String(s.w),
    PIXEL_SHOT_H: String(s.h),
    PIXEL_SHOT_OUT: png,
    ...(s.js ? { PIXEL_SHOT_JS: '1' } : {}),
    ...(s.dark ? { PIXEL_SHOT_DARK: '1' } : {}),
  };
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      execFileSync(EXE, [SHOT], { cwd: ROOT, encoding: 'utf8', timeout: 90000, stdio: 'ignore', env });
    } catch {
      // GUI-subsystem electron.exe loses the exit code; judge by the artifact
    }
    done = fs.existsSync(png) && fs.statSync(png).size > 1000;
    if (!done) {
      const boot = path.join(ROOT, 'electron-shot-boot.log');
      const logFile = png + '.log';
      const parts = [];
      if (fs.existsSync(logFile)) parts.push(fs.readFileSync(logFile, 'utf8').trim());
      parts.push('boot-log: ' + (fs.existsSync(boot) ? 'present' : 'absent'));
      console.error(`attempt ${attempt}:`, parts.join(' | '));
    }
  }
  if (!done) { console.error(`FAILED: ${png}`); process.exit(3); }
  console.log('saved', png, `${s.w}x${s.h}`, `js=${s.js}`);
}
console.log('done');
