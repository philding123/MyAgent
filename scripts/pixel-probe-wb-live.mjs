#!/usr/bin/env node
// Extract precise geometry/color tokens from the LIVE WorkBuddy surfaces
// (v5.8.2 real UI) — the numeric source for the F38 alignment round.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('artifacts/pixel-evidence');
const PORT = process.argv[2] || '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
const ctx = browser.contexts()[0];
const main = ctx.pages().find((p) => /index\.html/.test(p.url()));

const probe = `(() => {
  const out = {};
  const q = (sel) => document.querySelector(sel);
  const info = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      bg: c.backgroundColor, color: c.color, fs: c.fontSize, fw: c.fontWeight, radius: c.borderRadius,
      border: c.borderTopWidth + ' ' + c.borderTopColor, padding: c.padding, display: c.display };
  };
  // walk: find elements whose class contains a token
  const byClass = (token) => info(q('[class*="' + token + '"]'));
  // menubar band
  out.menubar = byClass('menu-bar') || byClass('menubar') || byClass('title-bar') || byClass('titlebar');
  // find the menu labels row: 编辑
  const edit = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && e.textContent.trim() === '编辑(E)');
  out.menuItem = edit ? info(edit.parentElement) : null;
  // sidebar body
  out.sidebar = byClass('conversation-sidebar');
  out.sidebarHeader = byClass('sidebar-header');
  // logo + version
  const ver = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && /^V5\\.8/.test(e.textContent.trim()));
  out.version = ver ? info(ver) : null;
  const brand = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && e.textContent.trim() === 'WorkBuddy');
  out.brand = brand ? info(brand) : null;
  // nav items
  const navNew = [...document.querySelectorAll('div,span')].find(e => e.childElementCount <= 1 && e.textContent.trim() === '新建任务');
  out.navNewTask = navNew ? info(navNew.closest('div[class]') || navNew.parentElement) : null;
  const zhuli = [...document.querySelectorAll('div,span')].find(e => e.childElementCount <= 2 && e.textContent.trim().startsWith('助理'));
  out.navAssistant = zhuli ? info(zhuli.closest('div[class]') || zhuli.parentElement) : null;
  // section labels
  const sec = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && /^任务 \\(/.test(e.textContent.trim()));
  out.sectionTasks = sec ? info(sec) : null;
  // session row
  const sess = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && /排查Hermes/.test(e.textContent));
  out.sessionRow = sess ? info(sess.closest('div[class*="item"],div[class*="row"],li') || sess.parentElement) : null;
  // hero title
  const hero = [...document.querySelectorAll('div,span,h1,h2')].find(e => e.childElementCount === 0 && /我帮你/.test(e.textContent));
  out.heroTitle = hero ? info(hero) : null;
  // scene pill 办公
  const pill = [...document.querySelectorAll('div,span,button')].filter(e => e.textContent.trim() === '办公').pop();
  out.scenePill = pill ? info(pill.closest('button,div[class*="pill"],div[class*="tag"],div[class*="scene"]') || pill) : null;
  const chip = [...document.querySelectorAll('div,span,button')].filter(e => e.textContent.trim() === '创作文档').pop();
  out.chip = chip ? info(chip.closest('button,div[class]') || chip) : null;
  // composer
  out.composer = byClass('composer');
  out.composerInput = byClass('composer-input') || byClass('input-slot');
  const ta = q('textarea[placeholder*="今天"]') || q('[contenteditable][data-placeholder]');
  out.composerEditor = ta ? info(ta) : null;
  // model selector chip
  const model = [...document.querySelectorAll('div,span')].filter(e => /Deepseek-V4/.test(e.textContent) && e.childElementCount <= 2).pop();
  out.modelChip = model ? info(model) : null;
  // send button (circular)
  const sendBtn = [...document.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return Math.abs(r.width - r.height) < 4 && r.width > 28 && r.width < 48; }).pop();
  out.sendButton = sendBtn ? info(sendBtn) : null;
  // disclaimer
  const disc = [...document.querySelectorAll('div,span')].find(e => e.childElementCount === 0 && /内容由 AI 生成/.test(e.textContent));
  out.disclaimer = disc ? info(disc) : null;
  // suggestion chips
  const sug = [...document.querySelectorAll('div,span,button')].filter(e => e.childElementCount <= 1 && /做一份年报审计准备清单/.test(e.textContent)).pop();
  out.suggestion = sug ? info(sug.closest('button,div[class]') || sug) : null;
  // body bg + root font
  out.body = { bg: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily.slice(0, 60), fs: getComputedStyle(document.body).fontSize };
  return out;
})()`;

const cdp = await ctx.newCDPSession(main);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(800);
const mainTok = await main.evaluate(probe);
fs.writeFileSync(path.join(OUT, 'wb-live-tokens-main.json'), JSON.stringify(mainTok, null, 2));
console.log('MAIN', JSON.stringify(mainTok, null, 1).slice(0, 3800));

// settings window tokens
const settings = ctx.pages().find((p) => p !== main && /settings/i.test(p.url()));
if (settings) {
  const s2 = await ctx.newCDPSession(settings);
  await s2.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 680, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const st = await settings.evaluate(`(() => {
    const out = {};
    const q = (sel) => document.querySelector(sel);
    const info = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
      return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), bg:c.backgroundColor, color:c.color, fs:c.fontSize, fw:c.fontWeight, radius:c.borderRadius, border:c.borderTopWidth+' '+c.borderTopColor }; };
    out.window = info(document.body);
    out.searchBox = info(q('input[placeholder*="搜索"]'));
    const nav = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && e.textContent.trim() === '通用').pop();
    out.navItemActive = nav ? info(nav.closest('div[class]') || nav.parentElement) : null;
    const card = [...document.querySelectorAll('div')].filter(e => /语言/.test(e.textContent) && e.textContent.length < 3000).pop();
    out.card = card ? info(card) : null;
    const h = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && e.textContent.trim() === '常规').pop();
    out.sectionHeader = h ? info(h) : null;
    const label = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && e.textContent.trim() === '语言').pop();
    out.rowLabel = label ? info(label) : null;
    out.body = { bg: getComputedStyle(document.body).backgroundColor };
    return out;
  })()`);
  fs.writeFileSync(path.join(OUT, 'wb-live-tokens-settings.json'), JSON.stringify(st, null, 2));
  console.log('SETTINGS', JSON.stringify(st, null, 1).slice(0, 1800));
}

// search window tokens
const search = ctx.pages().find((p) => p !== main && /win/i.test(p.url()));
if (search) {
  const s3 = await ctx.newCDPSession(search);
  await s3.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 640, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const se = await search.evaluate(`(() => {
    const out = {};
    const info = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
      return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), bg:c.backgroundColor, color:c.color, fs:c.fontSize, radius:c.borderRadius }; };
    out.searchInput = info(q('input'));
    const tab = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && e.textContent.trim() === '全部').pop();
    out.tabActive = tab ? info(tab) : null;
    const empty = [...document.querySelectorAll('div,span')].filter(e => e.childElementCount === 0 && /输入关键字/.test(e.textContent)).pop();
    out.emptyText = empty ? info(empty) : null;
    const foot = [...document.querySelectorAll('div,span')].filter(e => /ESC 关闭窗口/.test(e.textContent)).pop();
    out.footer = foot ? info(foot.closest('div[class]') || foot) : null;
    out.body = { bg: getComputedStyle(document.body).backgroundColor };
    return out;
  })()`);
  fs.writeFileSync(path.join(OUT, 'wb-live-tokens-search.json'), JSON.stringify(se, null, 2));
  console.log('SEARCH', JSON.stringify(se, null, 1).slice(0, 1400));
}
browser.close();
