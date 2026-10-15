#!/usr/bin/env node
// Pixel-evidence capture (design/27 T29 evidence): connect to a running
// Electron app over CDP, enumerate page targets, screenshot surfaces at a
// fixed emulated viewport so WorkBuddy and MyAgent shots are comparable.
// Usage:
//   node scripts/pixel-capture.mjs --port 9333 --label wb --list
//   node scripts/pixel-capture.mjs --port 9333 --label wb --surfaces main,settings,search
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes('--' + name);
const PORT = opt('port', '9222');
const LABEL = opt('label', 'app');
const OUT = path.resolve(opt('out', 'artifacts/pixel-evidence'));
const VIEW = { width: +opt('vw', 1280), height: +opt('vh', 800) };

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 });
const ctx = browser.contexts()[0];
if (!ctx) { console.error('no browser context'); process.exit(2); }

const pages = ctx.pages();
const inventory = [];
for (const p of pages) {
  let title = '';
  try { title = await p.title(); } catch {}
  inventory.push({ url: p.url(), title });
}
console.log(JSON.stringify(inventory, null, 2));
if (has('--list')) { await browser.close(); process.exit(0); }

fs.writeFileSync(path.join(OUT, `${LABEL}-targets.json`), JSON.stringify(inventory, null, 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function emulate(page, w, h) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: false,
  });
  return cdp;
}

async function shot(page, name, w = VIEW.width, h = VIEW.height) {
  await page.bringToFront().catch(() => {});
  const cdp = await emulate(page, w, h);
  await sleep(350); // relayout after override
  const file = path.join(OUT, `${LABEL}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  console.log('saved', file);
  await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
}

function pick(re) {
  return pages.find((p) => re.test(p.url()));
}

const surfaces = (opt('surfaces', 'main')).split(',');
const main = pick(/index\.html|workbuddy|main/i) || pages[0];

for (const s of surfaces) {
  if (s === 'main') {
    await shot(main, 'main');
  } else if (s === 'settings') {
    await main.click('#btn-settings', { timeout: 5000 }).catch(async () => {
      // fallback: drive through the preload bridge in page world
      await main.evaluate(() => window.myagent?.rpc?.window?.({ action: 'openSettings' }));
    });
    await sleep(900);
    const w = pages.find((p) => /settings\.html/i.test(p.url())) || ctx.pages().find((p) => p !== main && /settings/i.test(p.url()));
    if (!w) { console.error('settings window not found'); continue; }
    await shot(w, 'settings');
    await w.close().catch(() => {});
    await sleep(400);
  } else if (s === 'search') {
    await main.click('#btn-search', { timeout: 5000 }).catch(async () => {
      await main.evaluate(() => window.myagent?.rpc?.window?.({ action: 'openSearch' }));
    });
    await sleep(900);
    const w = ctx.pages().find((p) => /search\.html/i.test(p.url()));
    if (!w) { console.error('search window not found'); continue; }
    await shot(w, 'search', 800, 640);
    await w.close().catch(() => {});
    await sleep(400);
  }
}

await browser.close();
process.exit(0);
