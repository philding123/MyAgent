#!/usr/bin/env node
// Outcome-based button audit: drive EVERY clickable control in the main,
// settings and search windows of the real app and assert the effect the
// control exists for — daemon state, window state, bytes on disk, what the
// LLM actually received. Presence checks do not count as a pass.
//   node scripts/button-audit.mjs [--port 9333] [--out artifacts/button-audit] [--exec <packaged binary>]
// --exec audits an installed/unpacked build (e.g. dist-installer/linux-unpacked/myagent)
// instead of the dev checkout.
// Linux without DISPLAY: wraps Electron in xvfb-run; root adds --no-sandbox.
// MYAGENT_TEST_SEAMS=1 answers OS file dialogs from a queue and records
// external links instead of launching a browser (app/main/index.js).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const PORT = opt('port', '9333');
const OUT = path.resolve(opt('out', path.join(ROOT, 'artifacts', 'button-audit')));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

// ---------- fixtures ----------
const { startMockLlm } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'mock-llm.mjs')).href);
const mock = await startMockLlm();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-audit-'));
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-audit-fx-'));
const ctxFile = path.join(fx, 'context-note.txt');
fs.writeFileSync(ctxFile, 'AUDIT_CONTEXT_TOKEN_42 lives in this file');
const libFile = path.join(fx, 'library-doc.md');
fs.writeFileSync(libFile, '# library doc\nAUDIT_LIBRARY_TOKEN');
const wsDir = path.join(fx, 'audit_workspace');
fs.mkdirSync(wsDir);
const syncDir = path.join(fx, 'sync-target');
const skillDir = path.join(fx, 'import-pack', 'audit-imported-skill');
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: audit-imported-skill\ndescription: imported by the button audit\n---\n# body\nAUDIT_IMPORTED_BODY\n');

// ---------- launch ----------
const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
// Linux: dev Electron needs --no-sandbox on the command line (sandbox check runs
// before app JS); a packaged build's launcher adds it itself (build/after-pack.cjs)
const extra = process.platform === 'linux' && !opt('exec', null) ? ['--no-sandbox'] : [];
const EXEC = opt('exec', null);
let cmd = EXEC ? path.resolve(EXEC) : process.execPath;
let cmdArgs = [...(EXEC ? [] : [electronJs, '.']), `--remote-debugging-port=${PORT}`, '--force-device-scale-factor=1', ...extra];
if (process.platform === 'linux' && !process.env.DISPLAY) {
  // a window manager is required for maximize/minimize to mean anything
  cmdArgs = ['-a', '-s', '-screen 0 1600x1000x24', 'sh', '-c', '(command -v openbox >/dev/null && openbox >/dev/null 2>&1 &); sleep 0.5; exec "$0" "$@"', cmd, ...cmdArgs];
  cmd = 'xvfb-run';
}
const child = spawn(cmd, cmdArgs, {
  cwd: ROOT, stdio: 'ignore', detached: process.platform !== 'win32',
  env: { ...process.env, MYAGENT_HOME: home, MYAGENT_TEST_SEAMS: '1', MYAGENT_DELIVERY_DIR: path.join(fx, 'delivery') },
});
const killTree = () => { try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGKILL'); } catch {} };

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(1000);
  try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch {}
}
if (!up) { console.error('CDP never came up'); killTree(); process.exit(2); }
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 30000 });
const ctx = browser.contexts()[0];

// ---------- helpers ----------
async function until(fn, ms = 6000, label = 'condition') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(120);
  }
  throw new Error('timeout waiting for ' + label + (last instanceof Error ? ' (' + last.message + ')' : ''));
}
const findPage = (re) => ctx.pages().find((p) => re.test(p.url()));
const waitPage = (re, ms = 6000) => until(() => findPage(re), ms, 'window ' + re);
async function closePage(re) { const p = findPage(re); if (p) { await p.close(); await until(() => !findPage(re), 4000, 'close ' + re); } }
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const rpcIn = (page, method, params) => page.evaluate(([m, p]) => window.myagent.invoke(m, p)
  .then((r) => (r.ok ? r.result : Promise.reject(new Error((r.error && r.error.message) || 'rpc error')))), [method, params || {}]);
const winIn = (page, action, ex) => page.evaluate(([a, e]) => window.myagent.windowAction(a, e), [action, ex || {}]);

const main = await waitPage(/index\.html/, 20000);
await main.waitForLoadState('load');
await until(() => main.evaluate(() => !!window.__myagentTest), 10000, 'renderer ready');
const rpc = (m, p) => rpcIn(main, m, p);
const win = (a, e) => winIn(main, a, e);
const seam = (e) => win('test-seam', e);
await rpc('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
await rpc('settings.set', { key: 'llm.model', value: 'audit-model' });
await main.setViewportSize({ width: 1280, height: 800 });

let shotN = 0;
async function shot(page, label) {
  shotN++;
  const file = path.join(OUT, `${String(shotN).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file }).catch(() => {});
}
let section = '';
async function audit(id, name, fn) {
  try {
    const note = await fn();
    results.push({ section, id, name, pass: true, note: note || '' });
    console.log('PASS ' + id + ' — ' + (note || ''));
  } catch (e) {
    results.push({ section, id, name, pass: false, note: String(e.message || e).slice(0, 300) });
    console.log('FAIL ' + id + ' — ' + String(e.message || e).slice(0, 200));
    await shot(main, 'fail-' + id);
  }
}
const settingsPanel = async () => {
  const s = await waitPage(/settings\.html/);
  await s.waitForLoadState('load');
  return until(() => s.evaluate(() => {
    const a = document.querySelector('.settings-navigation__item.active');
    const p = a && document.querySelector(`.settings-window-panel[data-panel="${a.dataset.panel}"]`);
    return a && p && !p.classList.contains('hidden') ? a.dataset.panel : null;
  }), 4000, 'settings panel');
};
const lastLlmUserText = () => {
  const r = mock.requests[mock.requests.length - 1];
  const u = r && [...r.messages].reverse().find((m) => m.role === 'user');
  return u ? String(u.content) : '';
};
// a turn is done when the LLM saw a NEW request and the UI is idle again
// (button enabled, progress line gone) — the button alone is racy: it stays
// enabled while the draft session is being created
let turnBase = 0;
const armTurn = () => { turnBase = mock.requests.length; };
const waitDone = () => until(async () => mock.requests.length > turnBase && main.evaluate(() =>
  !document.getElementById('btn-send').disabled && document.getElementById('progress-line').classList.contains('hidden')), 15000, 'engine turn done');
const msgsOf = async (id) => (await rpc('sessions.get', { id })).messages || [];

// seed: two loose sessions + one in a named space
const seedA = await rpc('sessions.create', { title: '审计-会话甲' });
const seedB = await rpc('sessions.create', { title: '审计-会话乙' });
await rpc('sessions.setSpace', { id: seedB.id, space: '审计空间' });
await rpc('sessions.appendMessage', { session_id: seedA.id, role: 'user', content: 'AUDIT_SEED_MESSAGE_ALPHA' });
await main.evaluate(() => window.__myagentTest.refresh());
await sleep(300);

// ======================= main window =======================
section = '主窗 · 窗带';
await audit('band-toggle', '折叠/展开侧栏', async () => {
  const w = () => main.evaluate(() => document.getElementById('sidebar').offsetWidth);
  const w0 = await w(); await main.click('#band-toggle'); const w1 = await until(async () => ((await w()) === 0 ? 0 : null) ?? false, 2000, 'collapse').catch(() => w());
  await main.click('#band-toggle'); const w2 = await w();
  expect(w0 === 360 && w1 === 0 && w2 === 360, `width ${w0}→${w1}→${w2}`);
  return `${w0}→${w1}→${w2}`;
});
await audit('band-search', '窗带搜索 → 全局搜索窗（输入框聚焦）', async () => {
  await main.click('#band-search');
  const s = await waitPage(/search\.html/);
  await s.waitForLoadState('load');
  const focused = await until(() => s.evaluate(() => document.activeElement && document.activeElement.id === 'q'), 3000, 'focus #q');
  await closePage(/search\.html/);
  return 'search window opened, #q focused=' + focused;
});
for (const [key, must] of [['edit', ['new-session', 'undo', 'copy', 'paste']], ['window', ['open-search', 'minimize', 'toggle-maximize']], ['help', ['open-manual']], ['about', []]]) {
  await audit('menu-' + key, `菜单标签 ${key} → 弹出该分区的菜单项（非一层套娃）`, async () => {
    const r = await win('menu-popup', { section: key });
    expect(r && Array.isArray(r.items) && r.items.length, 'no items returned: ' + JSON.stringify(r));
    const ids = r.items.map((i) => i.id);
    for (const m of must) expect(ids.includes(m), `missing ${m} in ${JSON.stringify(ids)}`);
    expect(!r.items.some((i) => /\((E|W|H|A)\)$/.test(i.label || '')), 'popup shows the section label as an item: ' + JSON.stringify(r.items));
    return r.items.map((i) => i.label).join(' / ');
  });
}
await audit('menu-edit-new', '编辑 → 新建任务 实际执行（进入草稿首页，不建会话）', async () => {
  await main.evaluate((id) => window.__myagentTest.openSession(id), seedA.id);
  const before = (await rpc('sessions.list')).length;
  expect(await seam({ menuClick: { section: 'edit', id: 'new-session' } }), 'menu item not found');
  await until(() => main.evaluate(() => document.getElementById('main').classList.contains('home')), 3000, 'home');
  expect((await rpc('sessions.list')).length === before, 'a session was created');
  return 'home draft, sessions ' + before;
});
await audit('menu-window-search', '窗口 → 全局搜索 实际打开搜索窗', async () => {
  await seam({ menuClick: { section: 'window', id: 'open-search' } });
  await waitPage(/search\.html/);
  await closePage(/search\.html/);
  return 'opened';
});
await audit('menu-help-manual', '帮助 → 使用手册 打开 README 预览', async () => {
  await seam({ menuClick: { section: 'help', id: 'open-manual' } });
  const p = await waitPage(/preview\.html.*README/);
  await p.waitForLoadState('load');
  const txt = await until(() => p.evaluate(() => document.getElementById('preview-container').textContent.length > 50 && document.getElementById('preview-title').textContent), 6000, 'README rendered');
  await p.close();
  return 'preview title=' + txt;
});
await audit('win-max', '最大化/还原 改变窗口状态', async () => {
  const s0 = await win('win-state');
  await main.click('#win-max');
  const s1 = await until(async () => { const s = await win('win-state'); return s.maximized !== s0.maximized ? s : null; }, 3000, 'maximize toggle');
  await main.click('#win-max');
  const s2 = await until(async () => { const s = await win('win-state'); return s.maximized === s0.maximized ? s : null; }, 3000, 'restore');
  return `maximized ${s0.maximized}→${s1.maximized}→${s2.maximized}`;
});
await audit('win-min', '最小化 让窗口最小化', async () => {
  await main.click('#win-min');
  const s = await until(async () => { const x = await win('win-state'); return x.minimized ? x : null; }, 3000, 'minimized');
  await seam({ restoreMain: true });
  await until(async () => { const x = await win('win-state'); return !x.minimized && x.visible; }, 3000, 'restore');
  return 'minimized=' + s.minimized + ', restored';
});

section = '主窗 · 侧栏';
await audit('btn-discover', '发现应用 → 主区技能页「全部」', async () => {
  await main.click('#btn-discover');
  await until(() => main.evaluate(() => !document.getElementById('hub').classList.contains('hidden')
    && document.querySelector('#hub .hub-tab.active').dataset.tab === 'skills'
    && document.querySelector('#hub-filters .hub-chip.active').dataset.filter === 'all'
    && document.querySelectorAll('#hub-skill-grid .skill-card').length > 10), 4000, 'hub skills/all');
  return 'hub open on 技能/全部';
});
await audit('btn-new', '新建任务 → 草稿首页（标题「新任务」、输入框聚焦、未建会话）', async () => {
  await main.evaluate((id) => window.__myagentTest.openSession(id), seedA.id);
  const before = (await rpc('sessions.list')).length;
  await main.click('#btn-new');
  const st = await main.evaluate(() => ({ home: document.getElementById('main').classList.contains('home'),
    focus: document.activeElement && document.activeElement.id, title: document.getElementById('session-title').textContent,
    hero: !!document.querySelector('#messages .home-hero') }));
  expect(st.home && st.focus === 'input' && st.hero, JSON.stringify(st));
  expect((await rpc('sessions.list')).length === before, 'session created on 新建任务');
  return JSON.stringify(st);
});
for (const [nav, panel] of [['nav-assistant', 'presets'], ['nav-tasks', 'tasks'], ['nav-library', 'library']]) {
  await audit(nav, `${nav} → 设置窗「${panel}」面板`, async () => {
    await main.click('#' + nav);
    const p = await settingsPanel();
    expect(p === panel, 'active panel ' + p);
    return 'panel=' + p;
  });
}
await audit('settings-panel-switch', '设置窗已开时再点另一导航 → 切到新面板（不是只聚焦旧面板）', async () => {
  // settings is open on 'library' from the previous step
  await main.click('#nav-tasks');
  const p = await until(async () => { const x = await settingsPanel(); return x === 'tasks' ? x : null; }, 3000, 'switch to tasks').catch(async () => settingsPanel());
  expect(p === 'tasks', 'still on ' + p);
  await closePage(/settings\.html/);
  return 'switched to tasks';
});
await audit('nav-hub', '专家·技能·连接器 → 主区技能页 + 导航高亮', async () => {
  await main.click('#nav-hub');
  const r = await until(() => main.evaluate(() => {
    const open = !document.getElementById('hub').classList.contains('hidden');
    const act = document.querySelector('#sb-nav .nav-item.active');
    return open && act && act.id === 'nav-hub' ? document.querySelectorAll('#hub-skill-grid .skill-card').length : 0;
  }), 3000, 'hub');
  return r + ' cards';
});
await audit('nav-more', '更多 → 弹出菜单，再点关闭，点外部关闭', async () => {
  const vis = () => main.evaluate(() => !document.getElementById('more-menu').classList.contains('hidden'));
  await main.click('#nav-more'); expect(await vis(), 'not opened');
  await main.click('#nav-more'); expect(!(await vis()), 'second click did not close');
  await main.click('#nav-more'); await main.mouse.click(900, 600); expect(!(await vis()), 'outside click did not close');
  return 'toggle + outside-close ok';
});
for (const [id, check] of [
  ['nav-memory', async () => { const p = await settingsPanel(); expect(p === 'memory', p); await closePage(/settings\.html/); return 'settings/memory'; }],
  ['nav-search', async () => { await waitPage(/search\.html/); await closePage(/search\.html/); return 'search window'; }],
  ['nav-connectors', async () => {
    await until(() => main.evaluate(() => !document.getElementById('hub').classList.contains('hidden')
      && document.querySelector('#hub .hub-tab.active').dataset.tab === 'connectors'), 3000, 'connectors tab');
    return 'hub/连接器';
  }],
  ['nav-market', async () => { const p = await settingsPanel(); expect(p === 'market', p); await closePage(/settings\.html/); return 'settings/market'; }],
]) {
  await audit(id, `更多 → ${id}`, async () => {
    await main.click('#nav-more');
    await main.click('#' + id);
    const r = await check();
    expect(await main.evaluate(() => document.getElementById('more-menu').classList.contains('hidden')), 'menu stayed open');
    return r;
  });
}
await audit('btn-settings', '设置 → 设置窗', async () => {
  await main.click('#btn-settings');
  await settingsPanel();
  await closePage(/settings\.html/);
  return 'opened';
});
await audit('session-row', '点击会话行 → 打开该会话并加载其消息', async () => {
  await main.evaluate(() => window.__myagentTest.refresh());
  await main.click(`#session-list li[data-id="${seedA.id}"]`);
  const st = await until(() => main.evaluate(() => ({ title: document.getElementById('session-title').textContent,
    msgs: [...document.querySelectorAll('#messages .msg.user')].map((m) => m.textContent).join('|'),
    active: (document.querySelector('#session-list li.active') || {}).dataset })), 3000, 'session opened');
  expect(st.title === '审计-会话甲' && st.msgs.includes('AUDIT_SEED_MESSAGE_ALPHA'), JSON.stringify(st));
  return st.title;
});
await audit('space-row-session', '空间分组下的会话行 → 打开且面包屑显示空间', async () => {
  await main.click(`.session-list-nested li[data-id="${seedB.id}"]`);
  const st = await until(() => main.evaluate(() => ({ title: document.getElementById('session-title').textContent,
    space: document.getElementById('crumb-space').textContent })), 3000, 'opened');
  expect(st.title === '审计-会话乙' && st.space === '审计空间', JSON.stringify(st));
  return JSON.stringify(st);
});

section = '主窗 · 顶栏';
for (const mode of ['ask', 'plan', 'craft']) {
  await audit('mode-' + mode, `模式按钮 ${mode} → daemon 持久化 + chip 同步`, async () => {
    await main.click(`#mode-switch button[data-mode="${mode}"]`);
    const s = await until(async () => { const x = await rpc('sessions.get', { id: seedB.id }); return x.mode === mode ? x : null; }, 3000, 'persisted mode');
    const chip = await main.evaluate(() => document.getElementById('sub-mode').textContent);
    const labels = { ask: '只读问答', plan: '计划模式', craft: '允许完全访问' };
    expect(chip.includes(labels[mode]), 'chip=' + chip);
    return 'session.mode=' + s.mode;
  });
}
await audit('btn-terminal', '终端 → 面板打开，键入命令真的执行并回显', async () => {
  await main.click('#btn-terminal');
  await until(() => main.evaluate(() => !!document.querySelector('#terminal-view .xterm')), 5000, 'xterm');
  await main.click('#terminal-view');
  // the typed text must NOT contain the expected output (a pty echoes input):
  // the shell has to compute 42 for the check to pass
  await main.keyboard.type(process.platform === 'win32' ? 'set /a X=40+2 >nul & call echo AUDIT_TERM_%X%' : 'echo AUDIT_TERM_$((40+2))');
  await main.keyboard.press('Enter');
  const txt = await until(() => main.evaluate(() => {
    const t = document.querySelector('#terminal-view .xterm-rows');
    return t && t.textContent.includes('AUDIT_TERM_42') ? t.textContent : null;
  }), 8000, 'terminal echo AUDIT_TERM_42');
  await main.click('#btn-terminal');
  expect(await main.evaluate(() => document.getElementById('terminal-panel').classList.contains('hidden')), 'did not close');
  return 'echoed AUDIT_TERM_42';
});
await audit('btn-preview', '预览 → 选文件 → 预览窗显示该文件内容', async () => {
  await seam({ pick: ctxFile });
  await main.click('#btn-preview');
  const p = await waitPage(/preview\.html/);
  await p.waitForLoadState('load');
  await until(() => p.evaluate(() => document.getElementById('preview-container').textContent.includes('AUDIT_CONTEXT_TOKEN_42')), 5000, 'file content in preview');
  await p.close();
  return 'preview shows the picked file';
});
await audit('btn-preview-cancel', '预览 → 取消选择 → 不开窗', async () => {
  const n = ctx.pages().length;
  await seam({ pick: null });
  await main.click('#btn-preview');
  await sleep(800);
  expect(ctx.pages().length === n, 'a window opened on cancel');
  return 'no window';
});
await audit('btn-search', '顶栏搜索 → 搜索窗', async () => {
  await main.click('#btn-search');
  await waitPage(/search\.html/);
  await closePage(/search\.html/);
  return 'opened';
});

section = '主窗 · 技能页';
await main.click('#nav-hub');
await audit('hub-chip-installed', '筛选「已安装」 → 只剩已安装技能', async () => {
  await main.click('#hub-filters .hub-chip[data-filter="installed"]');
  const names = await main.evaluate(() => [...document.querySelectorAll('#hub-skill-grid .skill-card')].map((c) => c.dataset.name));
  const installed = new Set((await rpc('skills.list')).map((s) => s.name));
  expect(names.length && names.every((n) => installed.has(n)), 'non-installed shown: ' + names.filter((n) => !installed.has(n)));
  expect(names.length === installed.size, `shown ${names.length} vs installed ${installed.size}`);
  return names.join(',');
});
for (const g of ['creative', 'dev', 'enterprise', 'document']) {
  await audit('hub-chip-' + g, `筛选「${g}」 → 只剩该分组`, async () => {
    await main.click(`#hub-filters .hub-chip[data-filter="${g}"]`);
    const { plugins } = await rpc('market.list');
    const want = plugins.filter((p) => p.group === g).map((p) => p.name).sort();
    const got = (await main.evaluate(() => [...document.querySelectorAll('#hub-skill-grid .skill-card')].map((c) => c.dataset.name))).sort();
    expect(JSON.stringify(want) === JSON.stringify(got), `want ${want} got ${got}`);
    return got.length + ' cards';
  });
}
await audit('hub-search', '搜索框 → 按名称/中文名过滤', async () => {
  await main.click('#hub-filters .hub-chip[data-filter="all"]');
  try {
    // matches name / zh name / descriptions: every card shown must contain the query
    await main.fill('#hub-search', 'MCP');
    const got = await main.evaluate(() => [...document.querySelectorAll('#hub-skill-grid .skill-card')].map((c) => c.dataset.name));
    const { plugins } = await rpc('market.list');
    const hay = (n) => { const p = plugins.find((x) => x.name === n); return [p.name, p.display_name, p.description, p.description_zh].join(' ').toLowerCase(); };
    expect(got.includes('mcp-builder') && got.every((n) => hay(n).includes('mcp')) && got.length < plugins.length, JSON.stringify(got));
    await main.fill('#hub-search', '主题工厂');
    const zh = await main.evaluate(() => [...document.querySelectorAll('#hub-skill-grid .skill-card')].map((c) => c.dataset.name));
    expect(zh.length === 1 && zh[0] === 'theme-factory', JSON.stringify(zh));
    await main.fill('#hub-search', 'zzzz-nothing');
    expect(await main.evaluate(() => !document.getElementById('hub-skill-empty').classList.contains('hidden')
      && document.querySelectorAll('#hub-skill-grid .skill-card').length === 0), 'empty state not shown');
    return `MCP→${got.join(',')}; 主题工厂→theme-factory; empty state`;
  } finally { await main.fill('#hub-search', ''); }
});
const cardBtn = (name) => `#hub-skill-grid .skill-card[data-name="${name}"] .sc-act`;
await audit('hub-install', '卡片「安装」 → 技能装入用户目录，按钮变「已安装」', async () => {
  await main.click(cardBtn('mcp-builder'));
  await until(() => main.evaluate((s) => document.querySelector(s).textContent === '已安装', cardBtn('mcp-builder')), 6000, '已安装');
  const s = (await rpc('skills.list')).find((x) => x.name === 'mcp-builder');
  expect(s && s.source === 'user' && fs.existsSync(path.join(home, 'skills', 'mcp-builder', 'SKILL.md')), 'not on disk');
  return 'installed to ' + path.join('skills', 'mcp-builder');
});
await audit('hub-toggle', '「已安装」再点 → 停用（引擎不再加载），再点 → 启用', async () => {
  await main.click(cardBtn('mcp-builder'));
  await until(async () => (await rpc('skills.list')).find((x) => x.name === 'mcp-builder').disable === true, 3000, 'disabled');
  await until(() => main.evaluate((s) => document.querySelector(s).textContent === '已停用', cardBtn('mcp-builder')), 3000, '已停用 label');
  await main.click(cardBtn('mcp-builder'));
  await until(async () => (await rpc('skills.list')).find((x) => x.name === 'mcp-builder').disable === false, 3000, 'enabled');
  return 'disable → enable round trip';
});
await audit('hub-view-only', '「仅查看」 → 打开上游 https 页面，不安装', async () => {
  await main.click(cardBtn('pdf'));
  const st = await until(async () => { const x = await seam({}); return x.external.length ? x : null; }, 3000, 'external link');
  expect(/^https:\/\/github\.com\/anthropics\/skills\/tree\/[0-9a-f]{40}\/skills\/pdf$/.test(st.external.pop()), 'wrong url');
  expect(!(await rpc('skills.list')).some((s) => s.name === 'pdf'), 'pdf got installed');
  return 'opened upstream page';
});
await rpc('presets.create', { name: '审计专家', description: 'AUDIT_PRESET_DESC', prompt: 'you are audit' });
await audit('hub-tab-experts', 'Tab 专家 → 显示预设', async () => {
  await main.click('#hub .hub-tab[data-tab="experts"]');
  await until(() => main.evaluate(() => document.querySelector('#hub-expert-grid').textContent.includes('审计专家')
    && document.querySelector('#hub-expert-grid').textContent.includes('AUDIT_PRESET_DESC')), 3000, 'preset card');
  return 'preset card shown';
});
await audit('hub-manage-experts', '管理专家 → 设置窗「presets」', async () => {
  await main.click('#hub-manage-experts');
  const p = await settingsPanel(); expect(p === 'presets', p); await closePage(/settings\.html/);
  return 'settings/presets';
});
await rpc('connectors.add', { name: 'auditmcp', command: process.execPath, args: [path.join(ROOT, 'tests', 'fixtures', 'mock-mcp-server.js')] });
await audit('hub-tab-connectors', 'Tab 连接器 → 显示连接器与连接状态', async () => {
  await main.click('#hub .hub-tab[data-tab="connectors"]');
  await until(() => main.evaluate(() => /auditmcp[\s\S]*已连接 · 1 个工具/.test(document.querySelector('#hub-connector-grid').textContent)), 6000, 'connected card');
  return 'auditmcp 已连接 · 1 个工具';
});
await audit('hub-manage-connectors', '管理连接器 → 设置窗「connectors」', async () => {
  await main.click('#hub-manage-connectors');
  const p = await settingsPanel(); expect(p === 'connectors', p); await closePage(/settings\.html/);
  return 'settings/connectors';
});
await audit('hub-tab-skills', 'Tab 技能 → 回到技能卡片', async () => {
  await main.click('#hub .hub-tab[data-tab="skills"]');
  await until(() => main.evaluate(() => !document.querySelector('.hub-pane[data-pane="skills"]').classList.contains('hidden')
    && document.querySelectorAll('#hub-skill-grid .skill-card').length > 10), 3000, 'skills pane');
  return 'ok';
});

section = '主窗 · 首页与输入区';
await main.click('#btn-new');
await audit('hero-pills', '场景切换 办公/开发/设计 → 激活态与 chip/建议随场景变化', async () => {
  const snap = () => main.evaluate(() => ({ active: document.querySelector('.home-hero__pills .pill.active').textContent.trim(),
    chips: [...document.querySelectorAll('.home-hero__chips .chip')].map((c) => c.textContent).join('|'),
    sugg: [...document.querySelectorAll('#suggestion-list .suggestion')].map((c) => c.textContent).join('|') }));
  const a = await snap();
  await main.click('.home-hero__pills .pill:nth-child(2)');
  const b = await snap();
  await main.click('.home-hero__pills .pill:nth-child(3)');
  const c = await snap();
  expect(b.active.includes('开发') && c.active.includes('设计'), 'active did not move: ' + a.active + '/' + b.active + '/' + c.active);
  expect(a.chips !== b.chips && b.chips !== c.chips, 'chips did not change');
  expect(a.sugg !== b.sugg, 'suggestions did not change');
  await main.click('.home-hero__pills .pill:nth-child(1)');
  return b.chips;
});
await audit('hero-chip', 'chip → 填入输入框并聚焦', async () => {
  const label = await main.evaluate(() => document.querySelector('.home-hero__chips .chip').textContent);
  await main.click('.home-hero__chips .chip');
  const st = await main.evaluate(() => ({ v: document.getElementById('input').value, f: document.activeElement.id }));
  expect(st.v.includes(label) && st.f === 'input', JSON.stringify(st));
  return st.v;
});
await audit('suggestion', '建议条 → 填入输入框', async () => {
  const label = await main.evaluate(() => document.querySelector('#suggestion-list .suggestion').textContent.replace('↗', '').trim());
  await main.click('#suggestion-list .suggestion');
  const v = await main.evaluate(() => document.getElementById('input').value);
  expect(v === label, v + ' vs ' + label);
  await main.fill('#input', '');
  return v;
});
await audit('btn-plus', '＋ → 弹出 @/技能 菜单，点外部关闭', async () => {
  const vis = () => main.evaluate(() => !document.getElementById('plus-menu').classList.contains('hidden'));
  await main.click('#btn-plus'); expect(await vis(), 'not opened');
  await main.mouse.click(900, 120); expect(!(await vis()), 'outside click did not close');
  return 'ok';
});
await audit('sub-workspace', '选择工作空间 → 选目录 → 首条消息建的会话 cwd=该目录 + 归入空间', async () => {
  await seam({ pick: wsDir });
  await main.click('#sub-workspace');
  await until(() => main.evaluate(() => document.getElementById('sub-workspace').textContent.includes('audit_workspace')), 3000, 'chip shows dir');
  mock.push([{ content: 'workspace reply' }]);
  await main.fill('#input', '工作空间测试');
  armTurn();
  await main.click('#btn-send');
  await waitDone();
  const s = (await rpc('sessions.list')).find((x) => x.title === '工作空间测试');
  expect(s && s.cwd === wsDir, 'cwd=' + (s && s.cwd));
  await until(() => main.evaluate(() => [...document.querySelectorAll('.space-row')].some((r) => r.textContent.includes('audit_workspace'))), 3000, 'space row');
  return 'cwd=' + s.cwd;
});
await audit('sub-mode-draft', '草稿态选「只读问答」 → 首条消息建的会话 mode=ask（引擎按 ask 跑）', async () => {
  await main.click('#btn-new');
  await main.click('#sub-mode');
  await main.click('#mode-menu .mode-menu-item:nth-child(1)');
  mock.push([{ content: 'ask reply' }]);
  await main.fill('#input', '只读模式测试');
  armTurn();
  await main.click('#btn-send');
  await waitDone();
  const s = (await rpc('sessions.list')).find((x) => x.title === '只读模式测试');
  expect(s && s.mode === 'ask', 'mode=' + (s && s.mode));
  const sys = mock.requests[mock.requests.length - 1].messages[0].content;
  expect(/ask/i.test(sys) && /只读|read-only/i.test(sys), 'engine system prompt is not ask mode');
  return 'mode=ask';
});
await audit('sub-mode-session', '会话中 chip 菜单切到「计划模式」 → daemon 持久化', async () => {
  const s = (await rpc('sessions.list')).find((x) => x.title === '只读模式测试');
  await main.click('#sub-mode').catch(() => {});
  const visible = await main.evaluate(() => !!document.getElementById('mode-menu'));
  if (!visible) {
    // wb hides the access chip inside a task; the topbar buttons are the control there
    await main.click('#mode-switch button[data-mode="plan"]');
  } else await main.click('#mode-menu .mode-menu-item:nth-child(2)');
  await until(async () => (await rpc('sessions.get', { id: s.id })).mode === 'plan', 3000, 'plan persisted');
  return visible ? 'chip menu' : 'topbar (chip hidden in task view)';
});
await audit('btn-context', '＋ → @ 添加上下文 → 选文件 → 发送后 LLM 收到文件内容', async () => {
  await main.click('#btn-new');
  await seam({ pick: ctxFile });
  await main.click('#btn-plus');
  await main.click('#btn-context');
  await until(() => main.evaluate(() => document.getElementById('input').value.includes('context-note.txt')), 3000, '@ token');
  await main.type('#input', '总结这个文件');
  mock.push([{ content: 'context reply' }]);
  armTurn();
  await main.click('#btn-send');
  await waitDone();
  const u = lastLlmUserText();
  expect(u.includes('AUDIT_CONTEXT_TOKEN_42'), 'LLM did not get the file: ' + u.slice(0, 120));
  return 'LLM user message carries the file content';
});
await audit('btn-slash', '＋ → / 调用技能 → 选技能 → 发送后 LLM 收到该技能正文', async () => {
  await main.click('#btn-new');
  await main.click('#btn-plus');
  await main.click('#btn-slash');
  const item = await until(() => main.evaluate(() => {
    const b = [...document.querySelectorAll('#skill-menu button')].find((x) => x.textContent === '/mcp-builder');
    return b ? true : null;
  }), 3000, 'skill menu lists installed skill');
  expect(item, 'no /mcp-builder');
  await main.evaluate(() => [...document.querySelectorAll('#skill-menu button')].find((x) => x.textContent === '/mcp-builder').click());
  const v = await main.evaluate(() => document.getElementById('input').value);
  expect(v.startsWith('/mcp-builder'), 'input=' + v);
  await main.type('#input', '帮我写个 MCP 服务器');
  mock.push([{ content: 'skill reply' }]);
  armTurn();
  await main.click('#btn-send');
  await waitDone();
  const u = lastLlmUserText();
  expect(/MCP Server Development Guide|mcp-builder/i.test(u) && u.length > 2000, 'skill body not delivered: ' + u.slice(0, 160));
  return 'LLM got the mcp-builder SKILL.md body';
});
await audit('composer-model', '模型 chip → 设置窗「model」面板，显示当前模型', async () => {
  const label = await main.evaluate(() => document.getElementById('composer-model').textContent);
  expect(label === 'audit-model', 'chip=' + label);
  await main.click('#composer-model');
  const p = await settingsPanel(); expect(p === 'model', p);
  const s = findPage(/settings\.html/);
  expect(await s.evaluate(() => document.getElementById('llm-model').value) === 'audit-model', 'model field');
  await closePage(/settings\.html/);
  return 'chip=audit-model → settings/model';
});
await audit('btn-send', '发送（Enter 与按钮）→ 草稿物化为会话 + 回复渲染 + 消息落库', async () => {
  await main.click('#btn-new');
  const before = (await rpc('sessions.list')).length;
  mock.push([{ content: 'AUDIT_REPLY_ONE' }]);
  await main.fill('#input', '审计发送');
  armTurn();
  await main.press('#input', 'Enter');
  await waitDone();
  const s = (await rpc('sessions.list')).find((x) => x.title === '审计发送');
  expect(s && (await rpc('sessions.list')).length === before + 1, 'no session');
  mock.push([{ content: 'AUDIT_REPLY_TWO' }]);
  await main.fill('#input', '第二条');
  armTurn();
  await main.click('#btn-send');
  await waitDone();
  const dom = await main.evaluate(() => [...document.querySelectorAll('#messages .msg.assistant .md')].map((m) => m.textContent.trim()).join('|'));
  expect(dom.includes('AUDIT_REPLY_ONE') && dom.includes('AUDIT_REPLY_TWO'), dom);
  const stored = await msgsOf(s.id);
  expect(stored.filter((m) => m.role === 'assistant').length === 2, 'stored ' + JSON.stringify(stored.map((m) => m.role)));
  const label = await main.evaluate(() => document.getElementById('btn-send').textContent);
  expect(label === '↑', 'send label changed to "' + label + '"');
  return 'two turns rendered + persisted';
});
await audit('btn-send-empty', '空输入点发送 → 不建会话、不请求 LLM', async () => {
  await main.click('#btn-new');
  const n = mock.requests.length; const before = (await rpc('sessions.list')).length;
  await main.fill('#input', '   ');
  armTurn();
  await main.click('#btn-send');
  await sleep(600);
  expect(mock.requests.length === n && (await rpc('sessions.list')).length === before, 'something happened');
  return 'no-op';
});

section = '主窗 · 运行中控件';
await audit('confirm-approve', 'plan 模式写文件 → 批准条「Approve」→ 文件真的写入', async () => {
  const s = await rpc('sessions.create', { title: '审计-确认', cwd: wsDir, mode: 'plan' });
  await main.evaluate((id) => window.__myagentTest.openSession(id), s.id);
  const target = path.join(wsDir, 'approved.txt');
  mock.push([{ content: '', tool_calls: [{ id: 'w1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: target, content: 'APPROVED' }) } }] }, { content: 'written' }]);
  await main.fill('#input', '写个文件');
  armTurn();
  await main.click('#btn-send');
  await until(() => main.evaluate(() => !document.getElementById('confirm-bar').classList.contains('hidden')), 8000, 'confirm bar');
  await main.click('#confirm-bar button.primary');
  await until(() => fs.existsSync(target) && fs.readFileSync(target, 'utf8') === 'APPROVED', 8000, 'file written');
  await waitDone();
  return 'approved.txt written';
});
await audit('confirm-deny', '批准条「Deny」→ 文件不写入，模型收到拒绝', async () => {
  const s = (await rpc('sessions.list')).find((x) => x.title === '审计-确认');
  const target = path.join(wsDir, 'denied.txt');
  mock.push([{ content: '', tool_calls: [{ id: 'w2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: target, content: 'NO' }) } }] }, { content: 'ok denied' }]);
  await main.fill('#input', '再写一个');
  armTurn();
  await main.click('#btn-send');
  await until(() => main.evaluate(() => !document.getElementById('confirm-bar').classList.contains('hidden')), 8000, 'confirm bar');
  await main.click('#confirm-bar button:not(.primary)');
  await waitDone();
  expect(!fs.existsSync(target), 'file was written despite deny');
  const tool = [...mock.requests[mock.requests.length - 1].messages].reverse().find((m) => m.role === 'tool');
  expect(tool && /deni|拒绝|refus/i.test(tool.content), 'model not told: ' + (tool && tool.content));
  return 'denied, not written; s=' + s.id.slice(0, 6);
});
await audit('artifact-card', '产物卡片 → 预览窗打开该文件', async () => {
  await until(() => main.evaluate(() => document.querySelectorAll('.artifact-card').length > 0), 3000, 'artifact card');
  await main.click('.artifact-card');
  const p = await waitPage(/preview\.html.*approved\.txt/);
  await p.waitForLoadState('load');
  await until(() => p.evaluate(() => document.getElementById('preview-container').textContent.includes('APPROVED')), 5000, 'content');
  await p.close();
  return 'preview of approved.txt';
});
await audit('continue', '步数上限 → 「继续」按钮 → 同一引擎继续并完成', async () => {
  await rpc('settings.set', { key: 'engine.maxSteps', value: 4 });
  const s = await rpc('sessions.create', { title: '审计-续跑', cwd: wsDir });
  await main.evaluate((id) => window.__myagentTest.openSession(id), s.id);
  const loop = (i) => ({ content: '', tool_calls: [{ id: 'l' + i, type: 'function', function: { name: 'list_dir', arguments: JSON.stringify({ path: wsDir }) } }] });
  mock.push([loop(1), loop(2), loop(3), loop(4)]);
  await main.fill('#input', '无限列目录');
  armTurn();
  await main.click('#btn-send');
  await until(() => main.evaluate(() => [...document.querySelectorAll('#messages button.primary')].some((b) => b.textContent === '继续')), 10000, '继续 button');
  const n = mock.requests.length;
  mock.push([{ content: 'AUDIT_CONTINUED_DONE' }]);
  await main.evaluate(() => [...document.querySelectorAll('#messages button.primary')].find((b) => b.textContent === '继续').click());
  await until(() => main.evaluate(() => document.getElementById('messages').textContent.includes('AUDIT_CONTINUED_DONE')), 10000, 'continued reply');
  expect(mock.requests.length > n, 'no new LLM request');
  await rpc('settings.set', { key: 'engine.maxSteps', value: 64 });
  return 'continued';
});

// ======================= settings window =======================
section = '设置窗';
await main.click('#btn-settings');
const st = await waitPage(/settings\.html/);
await st.waitForLoadState('load');
await sleep(500);
const sClick = (sel) => st.click(sel);
const goPanel = async (panel) => { await st.click(`.settings-navigation__item[data-panel="${panel}"]`); await until(() => st.evaluate((p) => !document.querySelector(`.settings-window-panel[data-panel="${p}"]`).classList.contains('hidden'), panel), 2000, 'panel ' + panel); };
const msgText = (id) => st.evaluate((i) => document.getElementById(i).textContent, id);
const navPanels = await st.evaluate(() => [...document.querySelectorAll('.settings-navigation__item')].map((b) => b.dataset.panel));
await audit('settings-nav', `左侧 ${navPanels.length} 个导航 → 各自面板显示、其余隐藏`, async () => {
  for (const p of navPanels) {
    await goPanel(p);
    const visible = await st.evaluate(() => [...document.querySelectorAll('.settings-window-panel')].filter((x) => !x.classList.contains('hidden')).map((x) => x.dataset.panel));
    expect(visible.length === 1 && visible[0] === p, p + ' → ' + visible);
  }
  return navPanels.join(',');
});
await audit('settings-search', '搜索设置项 → 只留匹配导航', async () => {
  await st.fill('#settings-search', '连接');
  const shown = await st.evaluate(() => [...document.querySelectorAll('.settings-navigation__item')].filter((b) => b.style.display !== 'none').map((b) => b.dataset.panel));
  await st.fill('#settings-search', '');
  expect(shown.length >= 1 && shown.includes('connectors') && shown.length < navPanels.length, JSON.stringify(shown));
  return shown.join(',');
});
await audit('theme-select', '主题 深色 → 设置窗与主窗都变深色并持久化', async () => {
  await goPanel('appearance');
  await st.selectOption('#theme-select', 'dark');
  await until(() => main.evaluate(() => document.body.dataset.theme === 'dark'), 3000, 'main dark');
  expect(await rpc('settings.get', { key: 'appearance.theme' }) === 'dark', 'not persisted');
  await st.selectOption('#theme-select', 'light');
  await until(() => main.evaluate(() => document.body.dataset.theme === 'light'), 3000, 'main light');
  return 'cross-window + persisted';
});
await audit('llm-fields', '模型 Base URL / Model 改动 → 持久化；API Key → 进 vault 不落明文', async () => {
  await goPanel('model');
  await st.fill('#llm-model', 'audit-model-2'); await st.press('#llm-model', 'Tab');
  await until(async () => (await rpc('settings.get', { key: 'llm.model' })) === 'audit-model-2', 3000, 'model saved');
  await until(() => main.evaluate(() => document.getElementById('composer-model').textContent === 'audit-model-2'), 3000, 'composer chip follows');
  await st.fill('#llm-key', 'sk-AUDIT-SECRET'); await st.press('#llm-key', 'Tab');
  await until(() => st.evaluate(() => document.getElementById('llm-key').value === ''), 2000, 'key field cleared');
  const all = await rpc('settings.all');
  expect(!JSON.stringify(all).includes('sk-AUDIT-SECRET'), 'plaintext key in settings');
  const vaultFile = path.join(home, 'keystore', 'vault.bin');
  const vraw = fs.existsSync(vaultFile) ? fs.readFileSync(vaultFile, 'utf8') : '';
  expect(vraw.includes('llm.apiKey') && !vraw.includes('sk-AUDIT-SECRET'), 'vault entry missing or plaintext');
  await st.fill('#llm-model', 'audit-model'); await st.press('#llm-model', 'Tab');
  return 'model persisted, chip follows, key in vault only';
});
await audit('btn-test-llm', '测试连接 → 对 mock 端点 OK；坏地址 → 显示失败', async () => {
  mock.push([{ content: 'pong' }]);
  await sClick('#btn-test-llm');
  await until(async () => (await msgText('llm-test-result')).startsWith('OK'), 6000, 'OK');
  await st.fill('#llm-base', 'http://127.0.0.1:9/v1'); await st.press('#llm-base', 'Tab');
  await sClick('#btn-test-llm');
  const bad = await until(async () => { const t = await msgText('llm-test-result'); return t.startsWith('fail') ? t : null; }, 8000, 'fail');
  await st.fill('#llm-base', mock.baseUrl); await st.press('#llm-base', 'Tab');
  return 'OK / ' + bad.slice(0, 40);
});
await audit('prewarm-chk', '预热进程池 → 设置持久化且引擎池真的起/停空闲进程', async () => {
  await goPanel('engine');
  await st.check('#prewarm-chk');
  await until(async () => (await rpc('settings.get', { key: 'engine.prewarm' })) === true && (await rpc('engine.status')).pool >= 1, 10000, 'idle engine');
  await st.uncheck('#prewarm-chk');
  await until(async () => (await rpc('settings.get', { key: 'engine.prewarm' })) === false && (await rpc('engine.status')).pool === 0, 8000, 'drained');
  return 'pool up then drained';
});
await audit('presets', '创建预设 → 列表出现；选中 + 删除 → 消失', async () => {
  await goPanel('presets');
  await st.fill('#preset-name', '审计预设二'); await st.fill('#preset-prompt', 'prompt');
  await sClick('#btn-preset-add');
  await until(() => st.evaluate(() => document.getElementById('preset-list').textContent.includes('审计预设二')), 3000, 'listed');
  expect((await rpc('presets.list')).some((p) => p.name === '审计预设二'), 'not stored');
  await st.evaluate(() => [...document.querySelectorAll('#preset-list li')].find((l) => l.textContent.includes('审计预设二')).click());
  await sClick('#btn-preset-remove');
  await until(async () => !(await rpc('presets.list')).some((p) => p.name === '审计预设二'), 3000, 'removed');
  return 'create + remove';
});
await audit('tasks', '定时任务 创建/选中删除/刷新', async () => {
  await goPanel('tasks');
  await st.fill('#task-name', '审计定时'); await st.fill('#task-prompt', 'p'); await st.fill('#task-interval', '30');
  await sClick('#btn-task-add');
  await until(() => st.evaluate(() => document.getElementById('task-list').textContent.includes('审计定时')), 3000, 'listed');
  const t = (await rpc('tasks.list')).find((x) => x.name === '审计定时');
  expect(t && t.intervalMs === 30 * 60000, 'interval ' + (t && t.intervalMs));
  await rpc('tasks.create', { name: '外部建的', prompt: 'p', intervalMs: 60000 });
  await sClick('#btn-task-refresh');
  await until(() => st.evaluate(() => document.getElementById('task-list').textContent.includes('外部建的')), 3000, 'refresh shows new');
  await st.evaluate(() => [...document.querySelectorAll('#task-list li')].find((l) => l.textContent.includes('审计定时')).click());
  await sClick('#btn-task-remove');
  await until(async () => !(await rpc('tasks.list')).some((x) => x.name === '审计定时'), 3000, 'removed');
  return 'create(30min) / refresh / remove';
});
await audit('library', '资料库 添加文件 → 引擎可读；选中移除；刷新', async () => {
  await goPanel('library');
  await seam({ pick: libFile });
  await sClick('#btn-lib-add');
  await until(() => st.evaluate(() => document.getElementById('lib-list').textContent.includes('library-doc.md')), 3000, 'listed');
  expect(fs.existsSync(path.join(home, 'library', 'library-doc.md')), 'not copied into library dir');
  fs.writeFileSync(path.join(home, 'library', 'dropped-in.txt'), 'x');
  await sClick('#btn-lib-refresh');
  await until(() => st.evaluate(() => document.getElementById('lib-list').textContent.includes('dropped-in.txt')), 3000, 'refresh');
  await st.evaluate(() => [...document.querySelectorAll('#lib-list li')].find((l) => l.textContent.includes('library-doc.md')).click());
  await sClick('#btn-lib-remove');
  await until(() => !fs.existsSync(path.join(home, 'library', 'library-doc.md')), 3000, 'removed');
  return 'add / refresh / remove';
});
await audit('connectors', '连接器 添加并连接 → 已连接；停用/启用；移除；刷新', async () => {
  await goPanel('connectors');
  await st.fill('#conn-name', 'audit2'); await st.fill('#conn-command', process.execPath);
  await st.fill('#conn-args', JSON.stringify([path.join(ROOT, 'tests', 'fixtures', 'mock-mcp-server.js')]));
  await sClick('#btn-conn-add');
  await until(async () => (await rpc('connectors.list')).some((c) => c.name === 'audit2' && c.state === 'connected'), 8000, 'connected');
  await sClick('#btn-conn-refresh');
  await until(() => st.evaluate(() => /audit2[\s\S]*已连接/.test(document.getElementById('conn-list').textContent)), 3000, 'listed connected');
  const li = () => `#conn-list li:has-text("audit2")`;
  await st.click(li() + ' >> text=停用');
  await until(async () => (await rpc('connectors.list')).find((c) => c.name === 'audit2').enabled === false, 3000, 'disabled');
  await st.click(li() + ' >> text=启用');
  await until(async () => { const c = (await rpc('connectors.list')).find((x) => x.name === 'audit2'); return c.enabled !== false && c.state === 'connected'; }, 8000, 're-enabled');
  await st.click(li() + ' >> text=移除');
  await until(async () => !(await rpc('connectors.list')).some((c) => c.name === 'audit2'), 3000, 'removed');
  await st.fill('#conn-name', 'bad'); await st.fill('#conn-command', 'x'); await st.fill('#conn-args', 'not json');
  await sClick('#btn-conn-add');
  await until(async () => (await msgText('conn-msg')).startsWith('fail'), 3000, 'bad args reported');
  return 'add/connect, toggle, remove, bad-args error';
});
await audit('update', '清单 URL 持久化；检查更新（不可达清单）→ 如实报错；应用更新（无已下载）→ 如实报错', async () => {
  await goPanel('update');
  await st.fill('#update-url', 'https://127.0.0.1:9/latest.json'); await st.press('#update-url', 'Tab');
  await until(async () => (await rpc('settings.get', { key: 'update.manifestUrl' })) === 'https://127.0.0.1:9/latest.json', 3000, 'url persisted');
  await sClick('#btn-update-check');
  const a = await until(async () => { const t = await msgText('update-msg'); return t && t !== 'checking…' ? t : null; }, 5000, 'check result');
  expect(/error|disabled|未配置/.test(a), 'claims success without a manifest: ' + a);
  await sClick('#btn-update-apply');
  const b = await until(async () => { const t = await msgText('update-msg'); return t !== a ? t : null; }, 5000, 'apply result');
  expect(/error/.test(b), 'apply claimed: ' + b);
  return a + ' / ' + b;
});
await audit('market-panel', '云端市场 搜索/安装首个结果（内置目录）+ 源设置持久化', async () => {
  await goPanel('market');
  await st.fill('#market-keywords', 'playwright');
  await sClick('#btn-market-search');
  await until(async () => (await msgText('market-msg')).startsWith('webapp-testing'), 4000, 'search hit');
  await sClick('#btn-market-install');
  await until(async () => (await msgText('market-msg')).includes('webapp-testing → installed'), 6000, 'installed');
  expect((await rpc('skills.list')).some((s) => s.name === 'webapp-testing'), 'not installed');
  await st.fill('#market-url', 'https://example.invalid/index.json'); await st.press('#market-url', 'Tab');
  await st.check('#market-insecure');
  await until(async () => (await rpc('settings.get', { key: 'market.url' })) === 'https://example.invalid/index.json'
    && (await rpc('settings.get', { key: 'market.allowInsecure' })) === true, 3000, 'persisted');
  await st.fill('#market-url', ''); await st.press('#market-url', 'Tab'); await st.uncheck('#market-insecure');
  return 'search → install webapp-testing; url/insecure persisted';
});
await audit('sync', '同步 保存目标/立即推送（文件落到目录）/立即拉取', async () => {
  await goPanel('sync');
  fs.mkdirSync(syncDir, { recursive: true });
  await st.fill('#sync-dir', syncDir);
  await sClick('#btn-sync-save');
  await until(async () => (await msgText('sync-msg')) === 'target saved', 3000, 'saved');
  await sClick('#btn-sync-push');
  const pushed = await until(async () => { const t = await msgText('sync-msg'); return t.startsWith('pushed') ? t : null; }, 5000, 'pushed');
  expect(fs.readdirSync(syncDir).length > 0, 'nothing written to sync dir');
  await sClick('#btn-sync-pull');
  const pulled = await until(async () => { const t = await msgText('sync-msg'); return t.startsWith('applied') ? t : null; }, 5000, 'pulled');
  await st.check('#sync-auto');
  await until(async () => (await rpc('sync.status')).auto === true, 3000, 'auto on');
  await st.uncheck('#sync-auto');
  return pushed + ' / ' + pulled + ' / auto toggle';
});
await audit('sandbox', '沙箱后端选择 → 持久化；云端字段持久化', async () => {
  await goPanel('sandbox');
  await st.fill('#sandbox-cloud-url', 'https://api.audit.example'); await st.press('#sandbox-cloud-url', 'Tab');
  await st.selectOption('#sandbox-backend', 'cloud');
  await until(async () => (await rpc('settings.get', { key: 'sandbox.backend' })) === 'cloud'
    && (await rpc('settings.get', { key: 'sandbox.cloud.url' })) === 'https://api.audit.example', 3000, 'persisted');
  await st.fill('#sandbox-cloud-id', 'sb-audit'); await st.press('#sandbox-cloud-id', 'Tab');
  await until(async () => (await rpc('settings.get', { key: 'sandbox.cloud.sandboxId' })) === 'sb-audit', 3000, 'id persisted');
  await st.fill('#sandbox-cloud-key', 'e2b-AUDIT-KEY'); await st.press('#sandbox-cloud-key', 'Tab');
  await until(() => st.evaluate(() => document.getElementById('sandbox-cloud-key').value === ''), 2000, 'key field cleared');
  const vraw = fs.readFileSync(path.join(home, 'keystore', 'vault.bin'), 'utf8');
  expect(vraw.includes('sandbox.cloud.apiKey') && !vraw.includes('e2b-AUDIT-KEY'), 'cloud key not in vault (or plaintext)');
  expect(!JSON.stringify(await rpc('settings.all')).includes('e2b-AUDIT-KEY'), 'cloud key plaintext in settings');
  await st.selectOption('#sandbox-backend', 'local');
  await until(async () => (await rpc('settings.get', { key: 'sandbox.backend' })) === 'local', 3000, 'back to local');
  return 'backend/url/id persisted, key → vault';
});
await audit('a2a', 'A2A 开关 → 端点真的可访问（agent card），关 → 不可访问', async () => {
  await goPanel('a2a');
  await st.check('#a2a-enabled');
  const url = await until(async () => { const t = await msgText('a2a-msg'); const m = /https?:\/\/\S+/.exec(t); return m ? m[0] : null; }, 5000, 'url');
  const base = url.replace(/\/$/, '');
  const card = await (await fetch(base + '/.well-known/agent.json').catch(() => fetch(base + '/.well-known/agent-card.json'))).json();
  expect(card && card.name, 'no agent card');
  await st.uncheck('#a2a-enabled');
  await until(async () => { try { await fetch(base + '/.well-known/agent.json'); return false; } catch { return true; } }, 5000, 'endpoint down');
  return 'card ' + card.name + ' then down';
});
await audit('skills-panel', '技能 导入目录 → 安装；勾选框停用/启用；uninstall 卸载', async () => {
  await goPanel('skills');
  await seam({ pick: skillDir });
  await sClick('#btn-import-skill');
  await until(async () => (await rpc('skills.list')).some((s) => s.name === 'audit-imported-skill'), 3000, 'imported');
  await until(() => st.evaluate(() => document.getElementById('skill-list').textContent.includes('audit-imported-skill')), 3000, 'listed');
  const row = '#skill-list li:has-text("audit-imported-skill")';
  await st.uncheck(row + ' input[type=checkbox]');
  await until(async () => (await rpc('skills.list')).find((s) => s.name === 'audit-imported-skill').disable === true, 3000, 'disabled');
  await st.check(row + ' input[type=checkbox]');
  await until(async () => (await rpc('skills.list')).find((s) => s.name === 'audit-imported-skill').disable === false, 3000, 'enabled');
  await st.click(row + ' button');
  await until(async () => !(await rpc('skills.list')).some((s) => s.name === 'audit-imported-skill'), 3000, 'uninstalled');
  return 'import / toggle / uninstall';
});
await audit('memory', '记忆 添加 → 下条消息 system 带上；× 删除 → 消失', async () => {
  await goPanel('memory');
  await st.fill('#mem-input', 'remember: AUDIT_MEMORY_PREF');
  await sClick('#btn-mem-add');
  await until(() => st.evaluate(() => document.getElementById('mem-list').textContent.includes('AUDIT_MEMORY_PREF')), 3000, 'listed');
  const s = await rpc('sessions.create', { title: '审计-记忆' });
  await rpc('engine.start', { sessionId: s.id });
  mock.push([{ content: 'mem ok' }]);
  await rpc('engine.userMessage', { sessionId: s.id, text: 'hi' });
  await until(() => mock.requests.length && JSON.stringify(mock.requests[mock.requests.length - 1].messages[0]).includes('AUDIT_MEMORY_PREF'), 8000, 'memory in system prompt');
  await st.click('#mem-list li:has-text("AUDIT_MEMORY_PREF") button');
  await until(async () => !(await rpc('memory.list')).some((m) => m.content.includes('AUDIT_MEMORY_PREF')), 3000, 'deleted');
  return 'reached system prompt, then deleted';
});
await audit('im', 'IM 保存 token（vault）/ 启动（假 token → 如实报错）/ 停止', async () => {
  await goPanel('im');
  await st.selectOption('#im-channel', 'telegram');
  await sClick('#btn-im-save');
  await until(async () => (await msgText('im-msg')).includes('为空'), 2000, 'empty token rejected');
  await st.fill('#im-token', '123456:AUDIT-FAKE-TOKEN-abcdefghijklmnopqrstuvwxyz');
  await sClick('#btn-im-save');
  await until(async () => (await msgText('im-msg')).includes('vault'), 3000, 'saved');
  expect(!JSON.stringify(await rpc('settings.all')).includes('AUDIT-FAKE-TOKEN'), 'token in settings');
  const tg = (await rpc('im.status')).find((c) => c.id === 'telegram');
  expect(tg.credential !== 'missing', 'credential still missing');
  await sClick('#btn-im-start');
  const started = await until(async () => { const t = await msgText('im-msg'); return t.startsWith('telegram →') || t.startsWith('fail') ? t : null; }, 20000, 'start result');
  expect(!/running|connected/.test(started) || /error|AUTH|fail/i.test(started), 'fake token reported as running: ' + started);
  await sClick('#btn-im-stop');
  await until(async () => (await msgText('im-msg')).includes('已停止'), 3000, 'stopped');
  return started.slice(0, 60);
});
await audit('export', '导出会话 JSON → 真的产出含会话的 JSON 文件，Key 已脱敏', async () => {
  await goPanel('data');
  const saved = path.join(fx, 'export.json');
  await seam({ pick: saved });
  const dl = st.waitForEvent('download', { timeout: 4000 }).catch(() => null);
  await sClick('#btn-export');
  const d = await dl;
  if (d) await d.saveAs(saved);
  await until(() => fs.existsSync(saved), 5000, 'export file at chosen path');
  const j = JSON.parse(fs.readFileSync(saved, 'utf8'));
  expect(Array.isArray(j.sessions) && j.sessions.some((s) => s.title === '审计发送'), 'sessions missing');
  expect(!fs.readFileSync(saved, 'utf8').includes('sk-AUDIT-SECRET'), 'secret leaked');
  return j.sessions.length + ' sessions exported';
});
await audit('clear', '清空全部数据 → 取消不删；确认后会话与记忆清空，主窗侧栏同步', async () => {
  const n0 = (await rpc('sessions.list')).length;
  st.once('dialog', (dg) => dg.dismiss());
  await sClick('#btn-clear');
  await sleep(500);
  expect((await rpc('sessions.list')).length === n0, 'deleted on cancel');
  st.once('dialog', (dg) => dg.accept());
  await sClick('#btn-clear');
  await until(async () => (await rpc('sessions.list')).length === 0, 4000, 'cleared');
  await until(() => main.evaluate(() => document.querySelectorAll('#session-list li, .session-list-nested li').length === 0), 4000, 'main sidebar emptied');
  return n0 + ' → 0, sidebar synced';
});
await audit('settings-close', '× 关闭 → 设置窗关闭', async () => {
  await sClick('#btn-close-settings');
  await until(() => !findPage(/settings\.html/), 3000, 'closed');
  return 'closed';
});

// ======================= search window =======================
section = '搜索窗';
const sa = await rpc('sessions.create', { title: '审计-搜索目标' });
await rpc('sessions.appendMessage', { session_id: sa.id, role: 'user', content: 'AUDIT_FINDME_TOKEN in a message' });
fs.writeFileSync(path.join(wsDir, 'findme.txt'), 'line one\nAUDIT_FINDME_TOKEN in a file\n');
await rpc('sessions.create', { title: 'ws holder', cwd: wsDir }); // a task with a workspace → file hits
await main.evaluate(() => window.__myagentTest.refresh());
await main.click('#band-search'); // topbar search is hidden on the draft home (wb)
const sw = await waitPage(/search\.html/);
await sw.waitForLoadState('load');
const rows = () => sw.evaluate(() => [...document.querySelectorAll('#results li')].map((l) => l.textContent));
await audit('search-enter', 'Enter → 结果列表（任务 + 文件）', async () => {
  await sw.fill('#q', 'AUDIT_FINDME_TOKEN');
  await sw.press('#q', 'Enter');
  const r = await until(async () => { const x = await rows(); return x.length && !/no results/.test(x[0]) ? x : null; }, 5000, 'results');
  expect(r.some((t) => t.startsWith('message') && t.includes('审计-搜索目标')), 'message hit missing: ' + r);
  expect(r.some((t) => t.startsWith('file') && t.includes('findme.txt')), 'file hit missing: ' + r);
  return r.length + ' results (task + file)';
});
await audit('search-tabs', 'Tab 任务/文件/全部 → 结果按类型过滤；空查询 → 空态', async () => {
  await sw.click('.gs-tab[data-tab="message"]');
  const m = await rows(); expect(m.every((t) => t.startsWith('message')), 'non-message in 任务: ' + m);
  await sw.click('.gs-tab[data-tab="file"]');
  const f = await rows(); expect(f.length && f.every((t) => t.startsWith('file')), 'bad 文件 tab: ' + f);
  await sw.click('.gs-tab[data-tab="all"]');
  await sw.fill('#q', '');
  await sw.click('.gs-tab[data-tab="message"]');
  const empty = await sw.evaluate(() => ({ e: !document.getElementById('gs-empty').classList.contains('hidden'), n: document.querySelectorAll('#results li').length }));
  expect(empty.e && empty.n === 0, 'empty state: ' + JSON.stringify(empty));
  await sw.click('.gs-tab[data-tab="all"]');
  return `任务 ${m.length} / 文件 ${f.length} / 空态 ok`;
});
await audit('search-keys', '↑↓ 移动选中，↵ 打开选中任务 → 主窗打开该会话', async () => {
  await sw.fill('#q', 'AUDIT_FINDME_TOKEN');
  await sw.press('#q', 'Enter');
  await until(async () => (await rows()).length > 0, 4000, 'results');
  const active = () => sw.evaluate(() => [...document.querySelectorAll('#results li')].findIndex((l) => l.classList.contains('active')));
  await sw.press('#q', 'ArrowDown');
  const a0 = await active();
  expect(a0 === 0, 'ArrowDown did not select row 0: ' + a0);
  await sw.press('#q', 'ArrowDown');
  expect((await active()) === Math.min(1, (await rows()).length - 1), "second ArrowDown did not advance");
  await sw.press('#q', 'ArrowUp');
  expect((await active()) === 0, 'ArrowUp did not move back');
  // walk with ↓ to the message hit, then ↵
  for (let i = 0; i < 20; i++) {
    const t = await sw.evaluate(() => (document.querySelector('#results li.active') || {}).textContent || '');
    if (t.includes('审计-搜索目标')) break;
    await sw.press('#q', 'ArrowDown');
  }
  // ↵ on a task row closes the search window — the press itself then rejects
  await sw.press('#q', 'Enter').catch(() => {});
  await until(() => main.evaluate(() => document.getElementById('session-title').textContent === '审计-搜索目标'), 4000, 'main opened the session');
  return 'opened 审计-搜索目标 in main';
});
await audit('search-click-message', '点击任务结果 → 主窗打开该会话，搜索窗关闭', async () => {
  await main.click('#btn-new');
  await main.click('#band-search');
  const s2 = await waitPage(/search\.html/);
  await s2.waitForLoadState('load');
  await s2.fill('#q', 'AUDIT_FINDME_TOKEN');
  await s2.press('#q', 'Enter');
  await until(() => s2.evaluate(() => [...document.querySelectorAll('#results li')].some((l) => l.textContent.includes('审计-搜索目标'))), 4000, 'hit');
  await s2.evaluate(() => [...document.querySelectorAll('#results li')].find((l) => l.textContent.includes('审计-搜索目标')).click());
  await until(() => main.evaluate(() => document.getElementById('session-title').textContent === '审计-搜索目标'), 4000, 'session opened');
  await until(() => !findPage(/search\.html/), 3000, 'search closed');
  return 'opened + closed';
});
await audit('search-click-file', '点击文件结果 → 预览窗打开该文件', async () => {
  await main.evaluate((id) => window.__myagentTest.openSession(id), sa.id);
  await main.click('#band-search');
  const s3 = await waitPage(/search\.html/);
  await s3.waitForLoadState('load');
  await s3.fill('#q', 'AUDIT_FINDME_TOKEN');
  await s3.press('#q', 'Enter');
  const hasFile = await until(() => s3.evaluate(() => [...document.querySelectorAll('#results li')].some((l) => l.textContent.startsWith('file'))), 4000, 'file hit');
  expect(hasFile, 'no file hit');
  await s3.evaluate(() => [...document.querySelectorAll('#results li')].find((l) => l.textContent.startsWith('file')).click());
  const p = await waitPage(/preview\.html.*findme\.txt/);
  await p.waitForLoadState('load');
  await until(() => p.evaluate(() => document.getElementById('preview-container').textContent.includes('AUDIT_FINDME_TOKEN')), 5000, 'content');
  await p.close();
  await closePage(/search\.html/);
  return 'preview findme.txt';
});
await audit('search-esc', 'ESC → 搜索窗关闭', async () => {
  await main.click('#band-search');
  const s4 = await waitPage(/search\.html/);
  await s4.waitForLoadState('load');
  await s4.press('#q', 'Escape').catch(() => {}); // closing the page rejects the press
  await until(() => !findPage(/search\.html/), 3000, 'closed');
  return 'closed';
});

// last: × on Windows hides to the tray (app keeps running, restorable);
// elsewhere it closes the window and the app quits with its last window
section = '主窗 · 窗带（收尾）';
let exited = false;
child.on('exit', () => { exited = true; });
await audit('win-close', process.platform === 'win32' ? '关闭 → 主窗隐藏到托盘（进程不退出，可恢复）' : '关闭 → 主窗关闭，最后一个窗口关闭后应用退出', async () => {
  if (process.platform === 'win32') {
    await main.click('#win-close');
    const s = await until(async () => { const x = await win('win-state').catch(() => null); return x && !x.visible ? x : null; }, 3000, 'hidden');
    await seam({ restoreMain: true });
    await until(async () => (await win('win-state')).visible, 3000, 'restored');
    return 'hidden (visible=' + s.visible + '), restored from tray path';
  }
  for (const p of ctx.pages()) if (p !== main) await p.close().catch(() => {});
  await main.click('#win-close').catch(() => {});
  await until(() => main.isClosed(), 4000, 'main window closed');
  await until(() => exited || (() => { try { process.kill(child.pid, 0); return false; } catch { return true; } })(), 8000, 'app exited');
  return 'window closed, app exited';
});

// ---------- report ----------
const passN = results.filter((r) => r.pass).length;
const md = [
  '# MyAgent 逐按钮行为审计（结果断言，非存在性）',
  '',
  `- 时间：${new Date().toISOString()}；平台：${process.platform}；${passN}/${results.length} PASS`,
  '- 每项断言按钮存在的「目的」：daemon 状态、窗口状态、磁盘文件、LLM 实际收到的内容；OS 对话框由 MYAGENT_TEST_SEAMS 队列应答。',
  '',
  '| 区域 | 控件 | 预期效果 | 结果 | 实测 |',
  '|---|---|---|---|---|',
  ...results.map((r) => `| ${r.section} | ${r.id} | ${r.name} | ${r.pass ? 'PASS' : '**FAIL**'} | ${String(r.note).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
].join('\n');
fs.writeFileSync(path.join(OUT, 'button-audit.md'), md + '\n');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`button audit: ${passN}/${results.length} PASS -> ${OUT}`);

await browser.close().catch(() => {});
killTree();
try { await mock.close(); } catch {}
process.exit(passN === results.length ? 0 : 1);
