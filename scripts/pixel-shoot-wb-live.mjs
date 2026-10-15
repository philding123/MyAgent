#!/usr/bin/env node
// Live WorkBuddy capture (design/27 evidence upgrade): connect to the running
// WorkBuddy over CDP, force the same 1280x800 @ dsf1 viewport as MyAgent's
// captures, and shoot the real rendered homepage + dump key geometry.
// Usage: node scripts/pixel-shoot-wb-live.mjs [outDir] [port]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'artifacts/pixel-evidence');
const PORT = process.argv[3] || '9333';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => /index\.html/.test(p.url())) || ctx.pages()[0];
console.log('target:', page.url());

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await page.bringToFront().catch(() => {});
await page.waitForLoadState('load').catch(() => {});
await page.waitForTimeout(2500); // fonts + React settle

// geometry probe: what does the REAL home look like structurally?
const geo = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, radius: cs.borderRadius };
  };
  const sidebarCandidates = ['#sidebar', '[class*="sidebar"]', '[class*="side-nav"]', '[class*="navigation"]'];
  const found = [];
  for (const sel of sidebarCandidates) {
    document.querySelectorAll(sel).forEach((el, i) => {
      if (i > 2) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      found.push({ sel: sel + ':' + (el.className || '').toString().slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor });
    });
  }
  return {
    title: document.title,
    bodyText: document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '),
    theme: document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme') || 'none',
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    sidebar: found,
    keyEls: ['.sk-titlebar', '[class*="titlebar"]', '[class*="topbar"]', '[class*="header"]', '[class*="composer"]', '[class*="home"]', '[class*="hero"]'].map(pick),
  };
});
fs.writeFileSync(path.join(OUT, 'wb-live-geometry.json'), JSON.stringify(geo, null, 2));
console.log(JSON.stringify(geo, null, 2).slice(0, 2500));

await page.screenshot({ path: path.join(OUT, 'wb-live-main.png'), animations: 'disabled', clip: { x: 0, y: 0, width: 1280, height: 800 } });
console.log('saved', path.join(OUT, 'wb-live-main.png'));

browser.close();
