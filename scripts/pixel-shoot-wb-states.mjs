#!/usr/bin/env node
// Live WorkBuddy state captures (design evidence upgrade): home hero, settings
// window, global-search window — via CDP against the running app.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'artifacts/pixel-evidence');
const PORT = process.argv[3] || '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
const ctx = browser.contexts()[0];
const main = ctx.pages().find((p) => /index\.html/.test(p.url()));
const cdp = await ctx.newCDPSession(main);
async function viewport(page, w, h) {
  const s = await ctx.newCDPSession(page);
  await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await page.bringToFront().catch(() => {});
  await sleep(600);
}
await viewport(main, 1280, 800);

// 1) home hero: click the WorkBuddy logo/title in the sidebar
const clicked = await main.evaluate(() => {
  const els = [...document.querySelectorAll('div,span')].filter((e) => e.childElementCount === 0 && /^WorkBuddy$/.test(e.textContent.trim()));
  const logo = els.find((e) => e.getBoundingClientRect().x < 360 && e.getBoundingClientRect().y < 120);
  if (logo) { logo.click(); return true; }
  return false;
});
console.log('logo clicked:', clicked);
await sleep(2000);
await main.screenshot({ path: path.join(OUT, 'wb-live-home.png'), animations: 'disabled' });
console.log('saved wb-live-home.png');
console.log('home text:', (await main.evaluate(() => document.body.innerText.slice(0, 300))).replace(/\n+/g, ' | '));

// 2) settings window: look for a settings/user entry — try Ctrl+comma first
await main.keyboard.press('Control+Comma');
await sleep(1800);
let settings = ctx.pages().find((p) => p !== main && /settings/i.test(p.url()));
if (!settings) {
  // fall back: click the user row at sidebar bottom
  await main.evaluate(() => {
    const els = [...document.querySelectorAll('div,span')].filter((e) => e.childElementCount === 0 && /131\*\*\*\*9237/.test(e.textContent.trim()));
    const u = els.find((e) => e.getBoundingClientRect().y > 600);
    if (u) u.click();
  });
  await sleep(1200);
  // screenshot the popup menu for evidence regardless
  await main.screenshot({ path: path.join(OUT, 'wb-live-usermenu.png'), animations: 'disabled' });
  const items = await main.evaluate(() => document.body.innerText.slice(-400));
  console.log('usermenu text:', items.replace(/\n+/g, ' | '));
}
settings = ctx.pages().find((p) => p !== main && /settings/i.test(p.url()));
if (settings) {
  await viewport(settings, 900, 680);
  await sleep(800);
  await settings.screenshot({ path: path.join(OUT, 'wb-live-settings.png'), animations: 'disabled' });
  console.log('saved wb-live-settings.png', settings.url().slice(0, 90));
}

// 3) global search window: Ctrl+K on main
await main.bringToFront().catch(() => {});
await main.keyboard.press('Control+KeyK');
await sleep(1800);
const search = ctx.pages().find((p) => p !== main && /global-search|search/i.test(p.url()));
if (search) {
  await viewport(search, 800, 640);
  await sleep(800);
  await search.screenshot({ path: path.join(OUT, 'wb-live-search.png'), animations: 'disabled' });
  console.log('saved wb-live-search.png', search.url().slice(0, 90));
} else {
  await main.screenshot({ path: path.join(OUT, 'wb-live-after-ctrlk.png'), animations: 'disabled' });
  console.log('no search window; after-ctrlk saved');
}
browser.close();
