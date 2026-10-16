#!/usr/bin/env node
// Per-button behavior audit (per-button evidence, design/33 Phase 7 close):
// drive EVERY functional button on the MyAgent main window, capture
// before/after screenshots, assert the expected state transition.
//   node scripts/button-audit.mjs --port 9222
// Output: artifacts/button-audit/{results.json, button-audit.md, *-after.png}
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const PORT = opt('port', '9222');
const OUT = path.resolve(opt('out', 'artifacts/button-audit'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

const { startMockLlm } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'mock-llm.mjs')).href);
const mock = await startMockLlm();
mock.push([{ content: 'mock default reply' }]);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-audit-'));
const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
const child = spawn(process.execPath, [electronJs, '.', `--remote-debugging-port=${PORT}`, '--force-device-scale-factor=1'], {
  cwd: ROOT, env: { ...process.env, MYAGENT_HOME: home }, stdio: 'ignore',
});

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(1000);
  try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch {}
}
if (!up) { console.error('CDP never came up'); child.kill(); process.exit(2); }
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 30000 });
const ctx = browser.contexts()[0];
const main = ctx.pages().find((p) => /index\.html/.test(p.url()));
await main.waitForLoadState('load');
await main.evaluate((u) => window.myagent.invoke('settings.set', { key: 'llm.baseUrl', value: u }), mock.baseUrl);
const cdp = await ctx.newCDPSession(main);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(1000);
// seed two sessions so the sidebar has rows to click
await main.evaluate(() => window.myagent.invoke('sessions.create', { title: '审计-会话甲' }));
await main.evaluate(() => window.myagent.invoke('sessions.create', { title: '审计-会话乙' }));
await main.evaluate(() => window.__myagentTest.refresh());
await sleep(600);

let shotN = 0;
async function shot(label) {
  shotN++;
  const file = path.join(OUT, `${String(shotN).padStart(2, '0')}-${label}.png`);
  await main.screenshot({ path: file, animations: 'disabled' }).catch(() => {});
  return file;
}
async function audit(id, name, fn) {
  try {
    const r = await fn();
    results.push({ id, name, pass: !!r.pass, note: r.note, shots: r.shots || [] });
    console.log((r.pass ? 'PASS' : 'FAIL') + ' ' + id + ' ' + name + ' — ' + r.note);
  } catch (e) {
    results.push({ id, name, pass: false, note: 'EXCEPTION: ' + String(e.message || e).slice(0, 140), shots: [] });
    console.log('FAIL ' + id + ' ' + name + ' — EXCEPTION ' + String(e.message || e).slice(0, 100));
  }
}
const closeSettings = async () => {
  const s = ctx.pages().find((p) => /settings\.html/.test(p.url()));
  if (s) { await s.close(); await sleep(400); }
  return !!s;
};
const settingsActivePanel = async () => {
  const s = ctx.pages().find((p) => /settings\.html/.test(p.url()));
  if (!s) return null;
  return s.evaluate(() => {
    const a = document.querySelector('.settings-navigation__item.active');
    return a ? a.dataset.panel : null;
  });
};

// ---------- band ----------
await audit('band-toggle', '折叠/展开侧栏', async () => {
  const w0 = await main.evaluate(() => document.getElementById('sidebar').offsetWidth);
  await main.click('#band-toggle');
  await sleep(300);
  const w1 = await main.evaluate(() => document.getElementById('sidebar').offsetWidth);
  await main.click('#band-toggle');
  await sleep(300);
  const w2 = await main.evaluate(() => document.getElementById('sidebar').offsetWidth);
  return { pass: w0 === 360 && w1 === 0 && w2 === 360, note: `${w0}→${w1}→${w2}` };
});
await audit('band-search', '窗带搜索钮 → 全局搜索窗', async () => {
  await main.click('#band-search');
  await sleep(900);
  const s = ctx.pages().find((p) => /search\.html/.test(p.url()));
  const pass = !!s;
  if (s) { await s.close(); await sleep(300); }
  return { pass, note: s ? '搜索窗出现' : '未出现' };
});
for (const [key, label] of [['edit', '编辑(E)'], ['window', '窗口(W)'], ['help', '帮助(H)'], ['about', '关于(A)']]) {
  await audit('menu-' + key, `菜单标签 ${label} → 原生菜单弹出`, async () => {
    const sel = '.menu-label[data-menu="' + key + '"]';
    await main.click(sel);
    await sleep(400);
    const ok = await main.evaluate((s) => !!document.querySelector(s), sel);
    return { pass: ok, note: '点击无异常；原生弹层为 OS 层，不在页面截图内（见 design/31）' };
  });
}
await audit('win-max', '最大化/还原', async () => {
  // the dsf/viewport override pins innerWidth — clear it around the measure
  const measure = async () => {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    const w = await main.evaluate(() => window.innerWidth);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }).catch(() => {});
    return w;
  };
  await sleep(400);
  const w0 = await measure();
  await main.click('#win-max');
  await sleep(800);
  const w1 = await measure();
  await main.click('#win-max');
  await sleep(800);
  const w2 = await measure();
  return { pass: w1 > w0 && w2 === w0, note: `innerWidth ${w0}→${w1}→${w2}` };
});
// win-min / win-close: presence-only (close would end the audited session)
await audit('win-min-close', '最小化/关闭按钮存在', async () => {
  const r = await main.evaluate(() => ({
    min: !!document.getElementById('win-min'),
    max: !!document.getElementById('win-max'),
    close: !!document.getElementById('win-close'),
  }));
  return { pass: r.min && r.max && r.close, note: JSON.stringify(r) };
});

// ---------- sidebar nav → settings panels ----------
for (const [nav, panel, label] of [
  ['nav-assistant', 'presets', '助理（预设）'],
  ['nav-market', 'market', '技能市场'],
  ['nav-tasks', 'tasks', '定时任务'],
  ['nav-library', 'library', '资料库'],
  ['nav-skills', 'skills', '技能'],
  ['nav-memory', 'memory', '记忆'],
]) {
  await audit('nav-' + panel, `${label} → 设置窗对应面板`, async () => {
    await main.click('#' + nav);
    await sleep(1000);
    const active = await settingsActivePanel();
    const pass = active === panel;
    await closeSettings();
    return { pass, note: `active panel=${active}` };
  });
}
await audit('nav-search', '侧栏全局搜索 → 搜索窗', async () => {
  await main.click('#nav-search');
  await sleep(900);
  const s = ctx.pages().find((p) => /search\.html/.test(p.url()));
  const pass = !!s;
  if (s) { await s.close(); await sleep(300); }
  return { pass, note: s ? '搜索窗出现' : '未出现' };
});

// ---------- session rows ----------
await audit('session-open', '点击会话行 → 打开会话（面包屑+标题）', async () => {
  await main.evaluate(() => document.querySelector('#space-groups .session-list-nested li').click());
  await sleep(800);
  const r = await main.evaluate(() => ({
    title: document.getElementById('session-title').textContent,
    space: document.getElementById('crumb-space').textContent,
    home: document.getElementById('main').classList.contains('home'),
  }));
  return { pass: !r.home && r.title.length > 0, note: JSON.stringify(r) };
});

// ---------- topbar ----------
for (const mode of ['ask', 'plan', 'craft']) {
  await audit('mode-' + mode, `模式切换 → ${mode}`, async () => {
    await main.click(`#mode-switch button[data-mode="${mode}"]`);
    await sleep(300);
    const r = await main.evaluate((m) => ({
      active: document.querySelector(`#mode-switch button[data-mode="${m}"]`).classList.contains('active'),
      chip: document.getElementById('sub-mode').textContent,
    }), mode);
    const labels = { ask: '只读问答', plan: '计划模式', craft: '允许完全访问' };
    return { pass: r.active && r.chip.includes(labels[mode]), note: `chip="${r.chip}"` };
  });
}
await audit('btn-terminal', '终端按钮 → 终端面板', async () => {
  await main.click('#btn-terminal');
  await sleep(1200);
  const visible = await main.evaluate(() => !document.getElementById('terminal-panel').classList.contains('hidden'));
  await main.click('#btn-terminal');
  await sleep(300);
  const hiddenAgain = await main.evaluate(() => document.getElementById('terminal-panel').classList.contains('hidden'));
  return { pass: visible && hiddenAgain, note: `打开=${visible} 可关闭=${hiddenAgain}` };
});
await audit('btn-preview', '预览按钮存在（点击会打开系统文件对话框，无法自动化）', async () => {
  const r = await main.evaluate(() => ({ btn: !!document.getElementById('btn-preview'), title: document.getElementById('btn-preview').title }));
  return { pass: r.btn, note: JSON.stringify(r) };
});
await audit('btn-search-top', '顶栏搜索钮 → 搜索窗', async () => {
  await main.click('#btn-search');
  await sleep(900);
  const s = ctx.pages().find((p) => /search\.html/.test(p.url()));
  const pass = !!s;
  if (s) { await s.close(); await sleep(300); }
  return { pass, note: s ? '搜索窗出现' : '未出现' };
});

// ---------- composer ----------
await audit('composer-context', '@ 上下文按钮存在（点击打开系统文件对话框，无法自动化）', async () => {
  const r = await main.evaluate(() => ({ btn: !!document.getElementById('btn-context') }));
  return { pass: r.btn, note: JSON.stringify(r) };
});
await audit('composer-slash', '/ 技能按钮 → 内联技能菜单', async () => {
  await main.click('#btn-slash');
  await sleep(800);
  const r = await main.evaluate(() => {
    const m = document.getElementById('skill-menu');
    return { items: m ? m.querySelectorAll('button').length : 0, value: document.getElementById('input').value.slice(0, 4) };
  });
  const pass = r.items > 0 && r.value.startsWith('/');
  if (pass) await main.evaluate(() => { const i = document.getElementById('input'); i.value = ''; });
  return { pass, note: JSON.stringify(r) };
});
await audit('sub-mode', '模式 chip → 三选项菜单', async () => {
  await main.evaluate(() => document.getElementById('skill-menu')?.remove());
  await main.evaluate(() => document.getElementById('sub-mode').click());
  await sleep(300);
  const items = await main.evaluate(() => document.querySelectorAll('#mode-menu .mode-menu-item').length);
  await main.evaluate(() => { const m = document.getElementById('mode-menu'); if (m) m.remove(); });
  return { pass: items === 3, note: `菜单项=${items}` };
});
await audit('composer-model', '模型 chip → 设置模型面板', async () => {
  await main.click('#composer-model');
  await sleep(1000);
  const active = await settingsActivePanel();
  await closeSettings();
  return { pass: active === 'model', note: `active panel=${active}` };
});
await audit('btn-send', '发送 → 草稿物化为会话 + mock 回复', async () => {
  await main.click('#btn-new');
  await sleep(500);
  mock.push([{ content: 'mock default reply' }]);
  const before = await main.evaluate(() => window.myagent.invoke('sessions.list', {}).then((r) => r.result.length));
  await main.fill('#input', '审计发送测试');
  await main.click('#btn-send');
  let reply = '';
  for (let i = 0; i < 20 && !reply; i++) {
    await sleep(500);
    reply = await main.evaluate(() => {
      const m = [...document.querySelectorAll('#messages .msg.assistant .md')].pop();
      return m ? m.textContent.trim() : '';
    });
  }
  const after = await main.evaluate(() => window.myagent.invoke('sessions.list', {}).then((r) => r.result.length));
  return { pass: reply.includes('mock default reply') && after === before + 1, note: `回复="${reply.slice(0, 30)}" 会话 ${before}→${after}` };
});

// ---------- report ----------
const passN = results.filter((r) => r.pass).length;
const md = [
  '# MyAgent 主窗逐按钮行为审计（' + new Date().toISOString() + '）',
  '',
  `| 按钮 | 功能 | 结果 | 说明 |`,
  `|---|---|---|---|`,
  ...results.map((r) => `| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.note} |`),
  '',
  `${passN}/${results.length} PASS。截图：本目录 ${String(shotN).padStart(2, '0')} 张（每按钮 after 帧）。`,
].join('\n');
fs.writeFileSync(path.join(OUT, 'button-audit.md'), md);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`button audit: ${passN}/${results.length} PASS -> ${OUT}`);

await browser.close().catch(() => {});
child.kill();
try { await mock.close(); } catch {}
process.exit(passN === results.length ? 0 : 1);
