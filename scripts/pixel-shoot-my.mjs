#!/usr/bin/env node
// MyAgent pixel evidence (design/27): launch the real app with an isolated
// MYAGENT_HOME, connect over CDP, and shoot main/settings/search at the same
// viewports as the WorkBuddy baselines (wb-*.png from pixel-shoot-wb.mjs).
// Usage: node scripts/pixel-shoot-my.mjs [outDir]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.resolve(process.argv[2] || 'artifacts/pixel-evidence');
const PORT = 9222;
fs.mkdirSync(OUT, { recursive: true });

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-px-'));
const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
const child = spawn(process.execPath, [electronJs, '.', `--remote-debugging-port=${PORT}`, '--force-device-scale-factor=1'], {
  cwd: ROOT,
  env: { ...process.env, MYAGENT_HOME: home },
  stdio: 'ignore',
  detached: false,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cdpBase = null;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    cdpBase = await r.json();
    break;
  } catch {}
}
if (!cdpBase) { console.error('CDP never came up'); child.kill(); process.exit(2); }

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
const ctx = browser.contexts()[0];

async function emulateShot(page, name, w, h, dark = false) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  if (dark) await page.evaluate(() => document.body.setAttribute('data-theme', 'dark'));
  await page.bringToFront().catch(() => {});
  await sleep(500);
  const file = path.join(OUT, `my-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  console.log('saved', file, `${w}x${h}`, dark ? 'dark' : '');
}

// main (hero state on a fresh home)
let main = ctx.pages().find((p) => /index\.html/.test(p.url()));
if (!main) { console.error('main page not found', ctx.pages().map((p) => p.url())); }
await emulateShot(main, 'main', 1280, 800);

// settings
await main.click('#btn-settings', { timeout: 5000 });
await sleep(1000);
const settings = ctx.pages().find((p) => /settings\.html/.test(p.url()));
if (settings) {
  await emulateShot(settings, 'settings', 900, 680);
  await settings.close();
  await sleep(400);
} else console.error('settings page not found');

// search (the topbar is hidden in the zero-session home state, so drive the
// preload bridge instead of clicking the hidden button)
await main.evaluate(() => window.myagent.windowAction('openSearch'));
await sleep(1000);
const search = ctx.pages().find((p) => /search\.html/.test(p.url()));
if (search) {
  await emulateShot(search, 'search', 800, 640);
  await search.close();
  await sleep(300);
} else console.error('search page not found');

// preview (F33): open the shared fixture through rpc.window openPreview
const fixture = path.join(ROOT, 'tests', 'fixtures', 'share-sample.txt');
await main.evaluate((p) => window.myagent.windowAction('openPreview', { path: p }), fixture);
await sleep(1200);
const preview = ctx.pages().find((p) => /preview\.html/.test(p.url()));
if (preview) {
  await emulateShot(preview, 'preview', 980, 720);
  await preview.close();
} else console.error('preview page not found');

// dark variants (F29 dark token table) through the REAL chain: setTheme on
// the bridge → main persists + broadcasts rpc:event app:theme → every open
// window applies data-theme itself. wb dark skeletons exist only for
// settings/search; main-dark/preview-dark are MyAgent-only evidence renders.
await main.evaluate(() => window.myagent.windowAction('setTheme', { theme: 'dark' }));
await sleep(800);
await emulateShot(main, 'main-dark', 1280, 800, true);

await main.click('#btn-settings', { timeout: 5000 });
await sleep(1000);
const settingsDark = ctx.pages().find((p) => /settings\.html/.test(p.url()));
if (settingsDark) {
  await emulateShot(settingsDark, 'settings-dark', 900, 680, true);
  await settingsDark.close();
  await sleep(400);
} else console.error('settings-dark page not found');

await main.evaluate(() => window.myagent.windowAction('openSearch'));
await sleep(1000);
const searchDark = ctx.pages().find((p) => /search\.html/.test(p.url()));
if (searchDark) {
  await emulateShot(searchDark, 'search-dark', 800, 640, true);
  await searchDark.close();
} else console.error('search-dark page not found');

await main.evaluate((p) => window.myagent.windowAction('openPreview', { path: p }), fixture);
await sleep(1200);
const previewDark = ctx.pages().find((p) => /preview\.html/.test(p.url()));
if (previewDark) {
  await emulateShot(previewDark, 'preview-dark', 980, 720, true);
  await previewDark.close();
} else console.error('preview-dark page not found');

// restore light so the persisted setting ends where it started
await main.evaluate(() => window.myagent.windowAction('setTheme', { theme: 'light' }));
await sleep(400);

await browser.close();
child.kill();
process.exit(0);
