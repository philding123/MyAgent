#!/usr/bin/env node
// Task parity harness: run the SAME real task prompt on wb (live CDP) and
// MyAgent (real app, real LLM config), record each side's execution path
// (tool activity timeline + periodic screenshots), then diff the paths.
//   node scripts/task-parity.mjs --side my          # spawns MyAgent (real home)
//   node scripts/task-parity.mjs --side wb          # spawns WorkBuddy.exe
//   node scripts/task-parity.mjs --side compare     # builds report.md from both timelines
// Both legs consume real model quota (MyAgent configured API / wb cloud) —
// run deliberately, one shot per invocation. Evidence: artifacts/task-parity/.

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const SIDE = opt('side', 'my');
const PORT = SIDE === 'wb' ? 9333 : 9222;
const OUT = path.resolve(opt('out', 'artifacts/task-parity'));
const TIMEOUT_SEC = parseInt(opt('timeout-sec', '1500'), 10);
const POLL_MS = 4000;
const SHOT_MIN_GAP_MS = 12000;
const TASK = '帮我做一下REA skill的调研报告以html文件交付';
const MY_WS = path.resolve(opt('ws', path.join(OUT, 'myagent-ws')));
// real LLM config (matches artifacts/real-llm-result.json; the key already
// lives in the real-home vault from the real-llm-check round)
const LLM_BASE_URL = opt('llm-base-url', 'https://api.20230112.xyz/v1');
const LLM_MODEL = opt('llm-model', 'gpt-6.1-sol');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(MY_WS, { recursive: true });

function waitForCdp(port, tries) {
  return (async () => {
    for (let i = 0; i < (tries || 60); i++) {
      await sleep(1000);
      try { await fetch(`http://127.0.0.1:${port}/json/version`); return true; } catch {}
    }
    return false;
  })();
}

function treeKill(child) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else child.kill();
  } catch {}
}

// ---------- shared monitor: poll the page, diff conversation text, screenshot
async function monitor(page, side, timeline, isDone, deadline) {
  const t0 = Date.now();
  let prevLines = [];
  let lastShot = 0;
  let shotN = 0;
  const shot = (tag) => page.screenshot({
    path: path.join(OUT, `${side}-${String(shotN).padStart(3, '0')}${tag ? '-' + tag : ''}.png`),
    animations: 'disabled',
  }).catch(() => {});
  await shot('start');
  let done = null;
  while (Date.now() - t0 < deadline) {
    await sleep(POLL_MS);
    let snap;
    try {
      snap = await page.evaluate(() => ({
        text: document.body.innerText,
        chips: [...document.querySelectorAll('.tool-chip')].map((c) => ({
          name: (c.querySelector('.tool-name') || {}).textContent || '',
          summary: ((c.querySelector('.tool-summary') || {}).textContent || '').slice(0, 90),
          failed: !!c.querySelector('.tool-fail'),
        })),
        artifacts: [...document.querySelectorAll('.artifact-card .af-name')].map((e) => e.textContent),
        events: [...document.querySelectorAll('.sys-event')].map((e) => e.textContent.slice(0, 90)),
        sendBtn: (document.getElementById('btn-send') || {}).textContent || '',
      }));
    } catch (e) { timeline.push({ t: Date.now() - t0, kind: 'poll-error', note: String(e.message || e).slice(0, 100) }); continue; }
    const lines = snap.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const added = lines.filter((l) => !prevLines.includes(l));
    prevLines = lines;
    const changed = added.length > 0
      || JSON.stringify(snap.chips) !== JSON.stringify((timeline.chipsSig || null));
    if (snap.chips && snap.chips.length !== (timeline.chipsSig || []).length) {
      timeline.push({ t: Date.now() - t0, kind: 'chips', chips: snap.chips });
      timeline.chipsSig = snap.chips;
    }
    if (snap.artifacts && snap.artifacts.length && snap.artifacts.length !== (timeline.artSig || 0)) {
      timeline.push({ t: Date.now() - t0, kind: 'artifacts', artifacts: snap.artifacts });
      timeline.artSig = snap.artifacts.length;
    }
    if (snap.events && snap.events.length !== (timeline.evSig || 0)) {
      timeline.push({ t: Date.now() - t0, kind: 'events', events: snap.events.slice((timeline.evSig || 0)) });
      timeline.evSig = snap.events.length;
    }
    if (added.length && !snap.chips.length) {
      // plain conversation text deltas (wb has no stable chip DOM — keep raw lines)
      timeline.push({ t: Date.now() - t0, kind: 'text', lines: added.slice(0, 12).map((l) => l.slice(0, 140)) });
    }
    if (changed && Date.now() - lastShot > SHOT_MIN_GAP_MS) { lastShot = Date.now(); await shot(String(shotN++).padStart(3, '0')); }
    done = await isDone(snap, timeline, t0);
    if (done) break;
  }
  await shot('final');
  return done || { reason: 'timeout', ms: Date.now() - t0 };
}

// ---------- MyAgent leg (real home => real llm.* settings + vault key) ----------
async function runMy() {
  const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
  const child = spawn(process.execPath, [electronJs, '.', `--remote-debugging-port=${PORT}`,
    '--force-device-scale-factor=1'], { cwd: ROOT, stdio: 'ignore' });
  const timeline = [];
  let browser = null;
  try {
    if (!(await waitForCdp(PORT))) throw new Error('MyAgent CDP never came up');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
    const ctx = browser.contexts()[0];
    const main = ctx.pages().find((p) => /index\.html/.test(p.url()));
    await main.waitForLoadState('load');
    await sleep(1500);
    // real-home store lost llm.* in the sqlite→json fallback (D10-adjacent
    // data loss) — restore through the product's own settings RPC; the vault
    // still holds llm.apiKey from the real-llm-check round
    await main.evaluate(async (cfg) => {
      const a = await window.myagent.invoke('settings.set', { key: 'llm.baseUrl', value: cfg.url });
      const b = await window.myagent.invoke('settings.set', { key: 'llm.model', value: cfg.model });
      if (!a.ok || !b.ok) throw new Error('settings.set failed');
    }, { url: LLM_BASE_URL, model: LLM_MODEL });
    // pre-create the task session with an explicit workspace so the HTML
    // deliverable lands in a known dir; open it, then send from the UI
    const wsArg = MY_WS.replace(/\\/g, '\\\\');
    const created = await main.evaluate(async (ws) => {
      const r = await window.myagent.invoke('sessions.create', { title: 'REA skill 调研报告', cwd: ws });
      if (!r.ok) throw new Error('sessions.create failed');
      return r.result;
    }, MY_WS);
    timeline.push({ t: 0, kind: 'session', id: created.id, ws: MY_WS });
    await main.evaluate((id) => window.__myagentTest.openSession(id), created.id);
    await sleep(800);
    await main.fill('#input', TASK);
    await main.click('#btn-send');
    timeline.push({ t: 0, kind: 'sent', task: TASK });
    const isDone = async (snap) => {
      // engine run: send button shows '…'; done when it returns to 发送 after
      // having been busy, or an engine error event fired
      if (snap.sendBtn === '…') { monitor.sawBusy = true; return null; }
      if (snap.events && snap.events.some((e) => /error|failed/i.test(e))) return { reason: 'error-event', ms: Date.now() - monitor.t0 };
      if (monitor.sawBusy && snap.sendBtn === '发送') return { reason: 'send-idle', ms: 0 };
      return null;
    };
    monitor.t0 = Date.now();
    const done = await monitor(main, 'my', timeline, isDone, TIMEOUT_SEC * 1000);
    timeline.push({ kind: 'terminal', ...done });
    const files = [];
    const walk = (dir, d) => {
      if (d > 4) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, d + 1);
        else files.push({ name: e.name, size: fs.statSync(full).size });
      }
    };
    walk(MY_WS, 0);
    timeline.push({ kind: 'workspace-files', files });
  } catch (e) {
    timeline.push({ kind: 'fatal', note: String(e.message || e).slice(0, 200) });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await sleep(500);
    treeKill(child);
  }
  fs.writeFileSync(path.join(OUT, 'my-timeline.json'), JSON.stringify(timeline, null, 2));
  console.log('my timeline ->', path.join(OUT, 'my-timeline.json'));
}

// ---------- wb leg (installed WorkBuddy, live CDP, real cloud agent) ----------
async function runWb() {
  const exe = 'D:\\tools\\workbuddy\\install\\WorkBuddy.exe';
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { cwd: path.dirname(exe), stdio: 'ignore' });
  const timeline = [];
  let browser = null;
  try {
    if (!(await waitForCdp(PORT, 90))) throw new Error('wb CDP never came up (login window? update?)');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
    const ctx = browser.contexts()[0];
    const main = ctx.pages().find((p) => /index\.html/.test(p.url())) || ctx.pages()[0];
    await main.bringToFront().catch(() => {});
    await sleep(2500);
    const bodyHas = async (s) => main.evaluate((t) => document.body.innerText.includes(t), s);
    if (await bodyHas('扫码') || await bodyHas('登录')) throw new Error('wb shows a login wall');
    // new-task draft, then type + send (Enter first; fallback: composer send button)
    const clickNew = await main.evaluate(() => {
      const el = [...document.querySelectorAll('div,span,button')]
        .filter((e) => e.childElementCount <= 1 && e.getBoundingClientRect().height > 0)
        .find((e) => e.textContent.trim() === '新建任务');
      if (el) { el.click(); return true; }
      return false;
    });
    await sleep(1800);
    const rect = await main.evaluate(() => {
      const cands = [...document.querySelectorAll('[contenteditable="true"]')]
        .map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(30, r.height / 2), w: r.width, h: r.height }; })
        .filter((c) => c.w > 200);
      return cands.length ? cands[cands.length - 1] : null;
    });
    if (!rect) throw new Error('wb composer editor not found');
    await main.mouse.click(rect.x, rect.y);
    await sleep(300);
    await main.keyboard.insertText(TASK);
    await sleep(400);
    timeline.push({ t: 0, kind: 'typed', newTaskClicked: clickNew });
    await main.keyboard.press('Enter');
    await sleep(2500);
    let stillThere = await main.evaluate(() => {
      const els = [...document.querySelectorAll('[contenteditable="true"]')];
      return els.some((el) => el.innerText.includes('REA'));
    });
    if (stillThere) {
      // Enter did not send: click the right-most enabled button inside the composer zone
      const clicked = await main.evaluate(() => {
        const eds = [...document.querySelectorAll('[contenteditable="true"]')];
        const ed = eds[eds.length - 1];
        const zone = ed.closest('[class]') ? ed.parentElement.parentElement : document.body;
        const r = ed.getBoundingClientRect();
        const btns = [...document.querySelectorAll('button,[role="button"]')]
          .filter((b) => { const q = b.getBoundingClientRect(); return q.y > r.y - 120 && q.y < r.bottom + 160 && q.x > r.x + r.width * 0.4 && q.width > 20 && q.height > 20; });
        const target = btns[btns.length - 1];
        if (target) { target.click(); return true; }
        return false;
      });
      timeline.push({ t: 0, kind: 'send-fallback-button', clicked });
      await sleep(2500);
    }
    timeline.push({ t: 0, kind: 'sent', task: TASK });
    let lastChange = Date.now();
    const isDone = async (snap) => {
      // wb terminal: completion markers, or conversation idle for 3 min after activity
      const t = snap.text;
      if (/任务已完成|已完成你的任务|报告已生成|调研报告已完成/.test(t)) return { reason: 'marker', ms: 0 };
      return null;
    };
    // idle tracking lives outside isDone (needs prevLines length history)
    const wrappedDone = async (snap, tl, t0) => {
      const d = await isDone(snap);
      if (d) return d;
      const last = tl[tl.length - 1];
      if (last && Date.now() - (last.at || t0) > 180000 && tl.length > 3) return { reason: 'idle-3min', ms: Date.now() - t0 };
      return null;
    };
    // patch: stamp every entry with wall t so idle detection can use it
    const origPush = timeline.push.bind(timeline);
    timeline.push = (e) => { e.at = Date.now(); origPush(e); };
    const done = await monitor(main, 'wb', timeline, wrappedDone, TIMEOUT_SEC * 1000);
    timeline.push({ kind: 'terminal', ...done });
  } catch (e) {
    timeline.push({ kind: 'fatal', note: String(e.message || e).slice(0, 200) });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await sleep(800);
    treeKill(child);
  }
  fs.writeFileSync(path.join(OUT, 'wb-timeline.json'), JSON.stringify(timeline, null, 2));
  console.log('wb timeline ->', path.join(OUT, 'wb-timeline.json'));
}

// ---------- compare ----------
async function compare() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  const my = read('my-timeline.json');
  const wb = read('wb-timeline.json');
  const fmt = (entries) => entries.map((e) => {
    const s = (e.t / 1000).toFixed(0).padStart(5);
    if (e.kind === 'chips') return `  ${s}s  chips: ${e.chips.map((c) => c.name + (c.failed ? '!FAILED' : '')).join(' | ')}`;
    if (e.kind === 'artifacts') return `  ${s}s  artifacts: ${e.artifacts.join(', ')}`;
    if (e.kind === 'events') return `  ${s}s  events: ${e.events.join(' // ')}`;
    if (e.kind === 'text') return `  ${s}s  text+: ${e.lines.slice(0, 4).join(' ⏎ ')}`;
    if (e.kind === 'workspace-files') return `  files: ${e.files.map((f) => f.name + '(' + f.size + 'B)').join(', ') || '(none)'}`;
    if (e.kind === 'terminal') return `  TERMINAL: ${e.reason}`;
    if (e.kind === 'fatal') return `  FATAL: ${e.note}`;
    return `  ${s}s  ${e.kind}: ${JSON.stringify(e).slice(0, 120)}`;
  }).join('\n');
  const myHtml = (my.find((e) => e.kind === 'workspace-files') || { files: [] }).files.filter((f) => f.name.endsWith('.html'));
  const wbText = JSON.stringify(wb);
  const wbHtmlMention = /\.html/.test(wbText);
  const md = `# Task parity: 「${TASK}」

- 生成时间：${new Date().toISOString()}
- MyAgent 终态：${JSON.stringify((my.find((e) => e.kind === 'terminal') || {}))}
- wb 终态：${JSON.stringify((wb.find((e) => e.kind === 'terminal') || {}))}
- MyAgent 工作区 HTML 交付物：${myHtml.length ? myHtml.map((f) => f.name + ' ' + f.size + 'B').join(', ') : '无'}
- wb 时间线是否出现 .html 字样：${wbHtmlMention}

## MyAgent 执行路径

\`\`\`
${fmt(my.filter((e) => e.kind !== 'session'))}
\`\`\`

## wb 执行路径

\`\`\`
${fmt(wb.filter((e) => !['session', 'typed'].includes(e.kind)))}
\`\`\`

截图证据：${OUT} 下 my-*.png / wb-*.png。
`;
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log(md.slice(0, 1200));
  console.log('report ->', path.join(OUT, 'report.md'));
}

if (SIDE === 'wb') await runWb();
else if (SIDE === 'compare') await compare();
else await runMy();
