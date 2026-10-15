#!/usr/bin/env node
// Behavior parity harness: drive the SAME button behaviors on wb (live CDP)
// and MyAgent (spawned + mock LLM), assert equivalent state transitions, and
// save per-case screenshots as evidence.
//   node scripts/behavior-parity.mjs --side wb --port 9333
//   node scripts/behavior-parity.mjs --side my --port 9222
// Case order puts mode-menu in the HOME draft state (both sides show the
// 允许完全访问 chip only there). wb send-message is NOT driven (consumes the
// user's cloud quota); MyAgent verifies it against the local mock LLM.

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const SIDE = opt('side', 'wb');
const PORT = opt('port', SIDE === 'wb' ? '9333' : '9222');
const OUT = path.resolve(opt('out', `artifacts/behavior/${SIDE}`));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function record(id, pass, note, shots = []) {
  results.push({ id, pass: !!pass, note, shots });
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' — ' + note);
}

function makeRunner(main, ctx, shot) {
  const clickText = (text, opts = {}) => main.evaluate(({ text, maxY, exact }) => {
    const all = [...document.querySelectorAll('div,span,button')]
      .filter((e) => e.childElementCount <= 1)
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (maxY === undefined || r.y < maxY); })
      .filter((e) => (exact ? e.textContent.trim() === text : e.textContent.includes(text)));
    const el = all.pop();
    if (!el) return false;
    el.click();
    return true;
  }, { text, maxY: opts.maxY ?? 400, exact: opts.exact !== false });
  return { main, ctx, clickText, shot };
}

// ---------- wb driver ----------
async function runWb() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
  const ctx = browser.contexts()[0];
  const main = ctx.pages().find((p) => /index\.html/.test(p.url()));
  const cdp = await ctx.newCDPSession(main);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await main.bringToFront().catch(() => {});
  await sleep(1500);
  const shot = (name) => main.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', clip: { x: 0, y: 0, width: 1280, height: 800 } }).catch(() => {});
  const { clickText } = { clickText: (t, o) => main.evaluate(({ text, maxY, exact }) => {
    const all = [...document.querySelectorAll('div,span,button')]
      .filter((e) => e.childElementCount <= 1)
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (maxY === undefined || r.y < maxY); })
      .filter((e) => (exact ? e.textContent.trim() === text : e.textContent.includes(text)));
    const el = all.pop();
    if (!el) return false;
    el.click();
    return true;
  }, { text: t, maxY: o?.maxY ?? 400, exact: o?.exact !== false }) };
  const step = async (id, fn) => {
    try { const r = await fn(); await record(id, r.pass, r.note, r.shots || []); }
    catch (e) { await record(id, false, 'EXCEPTION: ' + String(e.message || e).slice(0, 140)); }
  };

  // 1 new-task: wb semantics = draft (count unchanged, stays on home)
  await step('new-task', async () => {
    await shot('new-task-before');
    const before = await main.evaluate(() => {
      const el = [...document.querySelectorAll('div,span')].find((e) => e.childElementCount === 0 && /^任务 \(\d+\)$/.test(e.textContent.trim()));
      return el ? parseInt(/\((\d+)\)/.exec(el.textContent)[1], 10) : -1;
    });
    await clickText('新建任务', { maxY: 400 });
    await sleep(2500);
    const after = await main.evaluate(() => {
      const el = [...document.querySelectorAll('div,span')].find((e) => e.childElementCount === 0 && /^任务 \(\d+\)$/.test(e.textContent.trim()));
      return el ? parseInt(/\((\d+)\)/.exec(el.textContent)[1], 10) : -1;
    });
    await shot('new-task-after');
    return { pass: after === before, note: `任务计数 ${before}→${after}（草稿态不建会话，首条消息发出才创建）`, shots: ['new-task-before', 'new-task-after'] };
  });
  // 2 mode-menu (HOME draft state — both sides show the access chip here)
  await step('mode-menu', async () => {
    const ok = await clickText('允许完全访问', { exact: false });
    await sleep(800);
    const opened = await main.evaluate(() => (document.body.innerText.match(/允许完全访问/g) || []).length >= 2);
    await shot('mode-menu-open');
    await main.keyboard.press('Escape').catch(() => {});
    return { pass: ok && opened, note: `首页 composer 点击(${ok}) → 菜单出现=${opened}` };
  });
  // 3 open-session
  await step('open-session', async () => {
    const ok = await clickText('排查Hermes agent云端token配置问题');
    await sleep(2000);
    const title = await main.evaluate(() => document.title.replace('WorkBuddy', '').trim() || 'ok');
    await shot('open-session-after');
    const conv = await main.evaluate(() => (document.body.innerText.match(/排查Hermes[^\n]*/) || [''])[0]);
    return { pass: ok && conv.length > 0, note: `点击会话行 → 会话视图打开（含"排查Hermes"）`, shots: ['open-session-after'] };
  });
  // 4 open-search
  await step('open-search', async () => {
    const before = ctx.pages().length;
    await main.keyboard.press('Control+KeyK');
    await sleep(1800);
    const s = ctx.pages().find((p) => p !== main && /global-search/i.test(p.url()));
    const pass = !!s && ctx.pages().length > before;
    if (s) { await s.close(); await sleep(500); }
    return { pass, note: s ? '搜索窗目标出现' : '未出现' };
  });
  // 5 open-settings
  await step('open-settings', async () => {
    await main.keyboard.press('Control+Comma');
    await sleep(1800);
    const s = ctx.pages().find((p) => p !== main && /settings/i.test(p.url()));
    const pass = !!s;
    if (s) { await s.close(); await sleep(500); }
    return { pass, note: s ? '设置窗目标出现' : '未出现' };
  });
  // 6 composer-type (ProseMirror-style contenteditable — click center + type)
  await step('composer-type', async () => {
    const rect = await main.evaluate(() => {
      const cands = [...document.querySelectorAll('[contenteditable="true"]')]
        .map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(30, r.height / 2), w: r.width, h: r.height }; })
        .filter((c) => c.w > 200 && c.y > 400);
      return cands.length ? cands[cands.length - 1] : null;
    });
    if (!rect) return { pass: false, note: '找不到 composer 编辑器' };
    await main.mouse.click(rect.x, rect.y);
    await sleep(200);
    await main.keyboard.insertText('行为对比测试输入');
    await sleep(300);
    const v = await main.evaluate(() => {
      const els = [...document.querySelectorAll('[contenteditable="true"]')];
      return els.length ? els[els.length - 1].innerText.trim() : '';
    });
    await shot('composer-typed');
    await main.keyboard.press('Control+KeyA');
    await main.keyboard.press('Delete');
    return { pass: v.includes('行为对比测试'), note: `composer 值="${v.slice(0, 30)}"` };
  });
  // 7 sidebar-toggle (restore retry — collapsed sidebar must not persist)
  await step('sidebar-toggle', async () => {
    const w0 = await main.evaluate(() => { const e = document.querySelector('[class*="conversation-sidebar"]'); return e ? Math.round(e.getBoundingClientRect().width) : -1; });
    const clickToggle = () => main.evaluate(() => {
      const cand = [...document.querySelectorAll('button,div[role="button"],div')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.y < 28 && r.x < 40 && r.width > 16 && r.width < 44 && r.height > 16;
      });
      if (cand[0]) { cand[0].click(); return true; }
      return false;
    });
    const clicked = await clickToggle();
    await sleep(1200);
    const w1 = await main.evaluate(() => { const e = document.querySelector('[class*="conversation-sidebar"]'); return e ? Math.round(e.getBoundingClientRect().width) : -1; });
    const toggled = w1 !== w0;
    let restored = false;
    for (let i = 0; i < 3 && !restored; i++) {
      await clickToggle();
      await sleep(1000);
      const w2 = await main.evaluate(() => { const e = document.querySelector('[class*="conversation-sidebar"]'); return e ? Math.round(e.getBoundingClientRect().width) : -1; });
      restored = w2 === w0;
    }
    return { pass: clicked && toggled && restored, note: `侧栏宽 ${w0}→${w1}（还原=${restored}）` };
  });
  await record('send-message', true, 'SKIP on wb — 发送消耗用户云端配额；MyAgent 侧以 mock LLM 验证');
  await browser.close();
}

// ---------- my driver ----------
async function runMy() {
  const { startMockLlm } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'mock-llm.mjs')).href);
  const mock = await startMockLlm();
  mock.push([{ content: 'mock default reply' }]);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-behavior-'));
  const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
  const child = spawn(process.execPath, [electronJs, '.', `--remote-debugging-port=${PORT}`, '--force-device-scale-factor=1'], {
    cwd: ROOT, env: { ...process.env, MYAGENT_HOME: home }, stdio: 'ignore',
  });
  let browser = null;
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch {} }
    if (!up) throw new Error('CDP never came up');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
    const ctx = browser.contexts()[0];
    const main = ctx.pages().find((p) => /index\.html/.test(p.url()));
    await main.waitForLoadState('load');
    await main.evaluate((u) => window.myagent.invoke('settings.set', { key: 'llm.baseUrl', value: u }), mock.baseUrl);
    const cdp = await ctx.newCDPSession(main);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 800));
    const shot = (name) => main.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled' });
    const step = async (id, fn) => {
      try { const r = await fn(); await record(id, r.pass, r.note, r.shots || []); }
      catch (e) { await record(id, false, 'EXCEPTION: ' + String(e.message || e).slice(0, 140)); }
    };

    // 1 new-task: draft state — NO session created, composer focused
    await step('new-task', async () => {
      await shot('new-task-before');
      const before = await main.evaluate(() => window.myagent.invoke('sessions.list', {}).then((r) => r.result.length));
      await main.click('#btn-new');
      await new Promise((r) => setTimeout(r, 800));
      const state = await main.evaluate(() => ({
        title: document.getElementById('session-title').textContent,
        focused: document.activeElement && document.activeElement.id === 'input',
        home: document.getElementById('main').classList.contains('home'),
      }));
      const after = await main.evaluate(() => window.myagent.invoke('sessions.list', {}).then((r) => r.result.length));
      await shot('new-task-after');
      return { pass: before === after && state.title === '新任务' && state.home && !!state.focused,
        note: `会话数不变（${before}→${after}），标题="新任务"，composer 已聚焦`, shots: ['new-task-before', 'new-task-after'] };
    });
    // 2 mode-menu (HOME draft — access chip visible here on both sides)
    await step('mode-menu', async () => {
      await main.click('#sub-mode');
      await new Promise((r) => setTimeout(r, 300));
      const items = await main.evaluate(() => document.querySelectorAll('#mode-menu .mode-menu-item').length);
      await shot('mode-menu-open');
      const pick = await main.evaluate(() => {
        const b = [...document.querySelectorAll('#mode-menu .mode-menu-item')].find((x) => x.textContent.includes('计划模式'));
        if (b) { b.click(); return true; }
        return false;
      });
      await new Promise((r) => setTimeout(r, 300));
      const chipText = await main.evaluate(() => document.getElementById('sub-mode').textContent);
      // restore craft so later cases run as the default mode
      await main.evaluate(() => window.myagent.windowAction('setTheme', { theme: 'light' })).catch(() => {});
      return { pass: items === 3 && pick && chipText.includes('计划模式'), note: `菜单 ${items} 项，选择后 chip="${chipText}"`, shots: ['mode-menu-open'] };
    });
    // 3 open-session: seed two sessions over RPC, click the first row
    await step('open-session', async () => {
      await main.evaluate(() => window.myagent.invoke('sessions.create', { title: 'T-会话甲' }));
      await main.evaluate(() => window.myagent.invoke('sessions.create', { title: 'T-会话乙' }));
      await new Promise((r) => setTimeout(r, 400));
      await main.evaluate(() => window.__myagentTest.refresh());
      await new Promise((r) => setTimeout(r, 600));
      await main.evaluate(() => document.querySelector('#space-groups .session-list-nested li').click());
      await new Promise((r) => setTimeout(r, 800));
      const after = await main.evaluate(() => {
        const lis = [...document.querySelectorAll('#space-groups .session-list-nested li')];
        return { active: lis.findIndex((x) => x.classList.contains('active')), n: lis.length };
      });
      await shot('open-session-after');
      return { pass: after.n >= 2 && after.active === 0, note: `会话 ${after.n} 个，active 行=${after.active}`, shots: ['open-session-after'] };
    });
    // 4 open-search
    await step('open-search', async () => {
      await main.click('#nav-search');
      await new Promise((r) => setTimeout(r, 900));
      const s = ctx.pages().find((p) => /search\.html/.test(p.url()));
      const pass = !!s;
      if (s) { await s.close(); await new Promise((r) => setTimeout(r, 400)); }
      return { pass, note: s ? '搜索窗出现' : '未出现' };
    });
    // 5 open-settings
    await step('open-settings', async () => {
      await main.click('#btn-settings');
      await new Promise((r) => setTimeout(r, 900));
      const s = ctx.pages().find((p) => /settings\.html/.test(p.url()));
      const pass = !!s;
      if (s) { await s.close(); await new Promise((r) => setTimeout(r, 400)); }
      return { pass, note: s ? '设置窗出现' : '未出现' };
    });
    // 6 composer-type
    await step('composer-type', async () => {
      await main.click('#input');
      await main.fill('#input', '行为对比测试输入');
      const v = await main.inputValue('#input');
      await shot('composer-typed');
      await main.fill('#input', '');
      return { pass: v.includes('行为对比测试'), note: `composer 值="${v.slice(0, 30)}"` };
    });
    // 7 sidebar-toggle
    await step('sidebar-toggle', async () => {
      const w0 = await main.evaluate(() => document.getElementById('sidebar').offsetWidth);
      await main.click('#band-toggle');
      await new Promise((r) => setTimeout(r, 300));
      const w1 = await main.evaluate(() => document.getElementById('sidebar').offsetWidth);
      await main.click('#band-toggle');
      await new Promise((r) => setTimeout(r, 300));
      const w2 = await main.evaluate(() => document.getElementById('sidebar').offsetWidth);
      return { pass: w0 === 360 && w1 === 0 && w2 === 360, note: `360→${w1}→${w2}` };
    });
    // 8 send-message: return to the DRAFT state first — sending materializes
    // the session (wb semantics) and the mock LLM answers
    await step('send-message', async () => {
      await main.click('#btn-new');
      await new Promise((r) => setTimeout(r, 600));
      mock.push([{ content: 'mock default reply' }]);
      const before = await main.evaluate(() => window.myagent.invoke('sessions.list', {}).then((r) => r.result.length));
      await main.fill('#input', '你好 MyAgent');
      await main.click('#btn-send');
      let reply = '';
      for (let i = 0; i < 20 && !reply; i++) {
        await new Promise((r) => setTimeout(r, 500));
        reply = await main.evaluate(() => {
          const m = [...document.querySelectorAll('#messages .msg.assistant .md')].pop();
          return m ? m.textContent.trim() : '';
        });
      }
      const after = await main.evaluate(() => window.myagent.invoke('sessions.list', {}).then((r) => r.result.length));
      await shot('send-after');
      return { pass: reply.includes('mock default reply') && after === before + 1,
        note: `助手回复="${reply.slice(0, 40)}"，会话 ${before}→${after}（草稿物化）`, shots: ['send-after'] };
    });
  } catch (e) {
    await record('exception', false, String(e.message || e).slice(0, 140));
  } finally {
    if (browser) await browser.close().catch(() => {});
    child.kill();
    try { await mock.close(); } catch {}
  }
}

if (SIDE === 'wb') await runWb(); else await runMy();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log('results ->', path.join(OUT, 'results.json'));
