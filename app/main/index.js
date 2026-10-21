'use strict';
// Electron main entry (F01/F02/F16). Narrow IPC surface: one 'rpc' handle +
// event broadcast, window controls, deeplink queue, smoke-test hook.

const { app, ipcMain, dialog, BrowserWindow, Menu, shell } = require('electron');
const { DaemonClient } = require('./daemon-client');
const windows = require('./windows');
const { createTray, parseDeeplink } = require('./tray');
const { Updater } = require('./updater');
const { buildMenu } = require('./menu');
const splash = require('./splash');
const fs = require('fs');
const path = require('path');

let daemon;
let tray = null;
let updater = null;
let smokeResult = { steps: [], ok: true };
const pendingUrls = [];

// GPU process crash-loops on this machine (exit_code=-2147483645, only inside
// the Chromium sandbox → "GPU process isn't usable. Goodbye.") and kills the
// app before any window shows; --disable-gpu alone does NOT recover it, the
// proven combo is no-sandbox + disable-gpu (bare-electron repro, smoke runs).
// Trade-off, accepted for this personal local app: pages are loadFile-local
// only, CSP default-src 'self', contextIsolation on, nodeIntegration off, and
// the renderer reaches the system solely through the narrow daemon RPC. The
// file/command sandbox lives in the daemon layer and is unaffected.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.disableHardwareAcceleration();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => String(a).startsWith('myagent://'));
    if (url) queueDeeplink(url);
    // F24: share activation of a second instance forwards --share here
    const sIdx = argv.indexOf('--share');
    if (sIdx >= 0 && argv[sIdx + 1]) handleShare(argv[sIdx + 1]);
    const main = windows.get('main');
    if (main) { main.show(); main.focus(); }
  });

  app.setAsDefaultProtocolClient('myagent');

  app.whenReady().then(bootstrap);
}

function queueDeeplink(url) {
  const parsed = parseDeeplink(url);
  if (parsed) pendingUrls.push(parsed);
  deliverPendingUrls();
}

/** F24: a shared file arrives → new session with a reference message. */
async function handleShare(filePath) {
  try {
    const abs = path.resolve(filePath);
    const r = await daemon.request('sessions.create', { title: 'Shared: ' + path.basename(abs) });
    if (r.ok && r.result && r.result.id) {
      await daemon.request('sessions.appendMessage', {
        session_id: r.result.id, role: 'user', content: '[shared file] ' + abs,
      });
      pendingUrls.push({ action: 'session', id: r.result.id });
      deliverPendingUrls();
    }
  } catch (e) {
    console.error('[share] failed:', e.message);
  }
}

function deliverPendingUrls() {
  const main = windows.get('main');
  if (main && !main.isDestroyed() && pendingUrls.length) {
    main.webContents.send('rpc:event', { topic: 'app:pendingUrls', payload: pendingUrls.splice(0) });
  }
}

async function bootstrap() {
  // F36: splash first (wb resolveSplashPreload semantics), closed when the
  // main window finishes loading; 15s failsafe so it can never stick.
  splash.createSplash();
  setTimeout(() => splash.closeSplash(), 15000);

  daemon = new DaemonClient();
  daemon.start();

  ipcMain.handle('rpc', (_e, req) => daemon.request(req.method, req.params));
  ipcMain.handle('rpc.window', async (_e, req) => {
    if (req.action === 'openSettings') windows.createSettings(req.panel);
    if (req.action === 'openSearch') windows.createSearch();
    if (req.action === 'openPreview' && req.path) windows.createPreview(String(req.path));
    // F54: catalog homepage links (view-only skills) — https only, OS browser
    if (req.action === 'openExternal') {
      let u = null;
      try { u = new URL(String(req.url || '')); } catch (_) {}
      if (!u || u.protocol !== 'https:') return false;
      await shell.openExternal(u.href);
      return true;
    }
    if (req.action === 'pickFile') {
      return dialog.showOpenDialog({ properties: ['openFile'] }).then((r) => (r.canceled ? null : r.filePaths[0]));
    }
    if (req.action === 'setTheme') {
      windows.setTheme(req.theme);
      // F29: persist so relaunch and new windows come back in the same theme
      daemon.request('settings.set', { key: 'appearance.theme', value: req.theme }).catch(() => {});
    }
    if (req.action === 'theme') return windows.theme();
    if (req.action === 'updateCheck') {
      const v = await daemon.request('settings.get', { key: 'update.manifestUrl' }).catch(() => null);
      updater.manifestUrl = (v && v.result) || '';
      return updater.check();
    }
    if (req.action === 'updateApply') {
      const appRoot = path.dirname(app.getPath('exe'));
      return updater.apply({ appRoot, exeName: path.basename(process.execPath),
        quitFn: () => { global.__myagentQuitting = true; app.quit(); } });
    }
    if (req.action === 'updateState') return updater.status();
    if (req.action === 'pickDirectory') {
      return dialog.showOpenDialog({ properties: ['openDirectory'] }).then((r) => (r.canceled ? null : r.filePaths[0]));
    }
    // F38 band window controls + menu popups (frameless main window)
    if (req.action === 'win-minimize') { const w = windows.get('main'); if (w) w.minimize(); return null; }
    if (req.action === 'win-maximize') {
      const w = windows.get('main');
      if (w) { w.isMaximized() ? w.unmaximize() : w.maximize(); }
      return null;
    }
    if (req.action === 'win-close') { const w = windows.get('main'); if (w) w.close(); return null; }
    if (req.action === 'menu-popup') {
      const w = windows.get('main');
      if (w) global.__myagentMenu.popSection(req.section, w);
      return null;
    }
    return null;
  });

  daemon.on('event', (msg) => windows.broadcast('rpc:event', { topic: msg.topic, payload: msg.payload }));
  daemon.on('ready', () => {
    deliverPendingUrls();
    // F29: restore the persisted theme before any window paints its default
    daemon.request('settings.get', { key: 'appearance.theme' }).then((r) => {
      const t = r && r.result;
      if (t === 'dark' || t === 'light') windows.setTheme(t);
    }).catch(() => {});
  });
  daemon.on('down', () => windows.broadcast('rpc:event', { topic: 'daemon:status', payload: { state: 'reconnecting' } }));

  // F21 updater: shell-level concern (mirrors WorkBuddy updater outside the
  // app-server). Manifest URL lives in daemon settings; progress broadcasts.
  updater = new Updater({
    manifestUrl: '',
    currentVersion: app.getVersion(),
    emit: (_stage, payload) => windows.broadcast('rpc:event', { topic: 'app:update', payload }),
  });

  tray = createTray(require('electron'), {
    showMain: () => { const w = windows.createMain(null); w.show(); },
    quit: () => { global.__myagentQuitting = true; app.quit(); },
  });
  // tray must exist BEFORE the main window: the close-to-tray path in
  // windows.js refuses to hide when global.__myagentTray is unset.
  global.__myagentTray = tray;
  tray.on('double-click', () => { const w = windows.createMain(null); w.show(); });

  windows.createMain({ onCreated: (_name, win) => {
    win.webContents.on('did-finish-load', () => { splash.closeSplash(); deliverPendingUrls(); });
  } });

  // F35: application menu (design/31-menu.md, wb band order); the in-DOM band
  // labels pop these native sections via rpc.window menu-popup
  const menuApi = buildMenu({ sendToMain: (msg) => windows.broadcast('rpc:event', msg) });
  global.__myagentMenu = menuApi;

  // cold-start deeplink from argv (Windows)
  const url = process.argv.find((a) => String(a).startsWith('myagent://'));
  if (url) queueDeeplink(url);

  // F24 share target: sparse MSIX helper forwards "--share <path>"
  const shareIdx = process.argv.indexOf('--share');
  if (shareIdx >= 0 && process.argv[shareIdx + 1]) handleShare(process.argv[shareIdx + 1]);

  app.on('activate', () => windows.createMain(null));
  app.on('before-quit', () => { global.__myagentQuitting = true; });
  app.on('window-all-closed', () => {
    if (process.env.MYAGENT_SMOKE || process.platform !== 'win32') app.quit();
  });

  if (process.env.MYAGENT_SMOKE) runSmoke();
}

/** E2E smoke (T01/T16/T17/T18 core): run assertions headless-ish, write JSON, exit. */
async function runSmoke() {
  const watchdog = setTimeout(() => finishSmoke(), 180000);
  const step = (name, ok, detail) => {
    smokeResult.steps.push({ name, ok, detail: detail === undefined ? null : detail });
    if (!ok) smokeResult.ok = false;
    console.log('[smoke]', name, ok ? 'ok' : 'FAIL', detail || '');
  };
  const finishSmoke = () => {
    clearTimeout(watchdog);
    const out = process.env.MYAGENT_SMOKE_OUT || path.join(__dirname, '..', '..', 'artifacts', 'smoke-result.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // The Electron/Windows process tree may outlive process.exit(); the runner
    // polls this file and force-kills leftovers, so exitCode lives in the JSON.
    const code = smokeResult.ok ? 0 : 1;
    fs.writeFileSync(out, JSON.stringify({ ...smokeResult, exitCode: code }, null, 2));
    console.log('[smoke] finishing, exitCode', code);
    try { daemon && daemon.shutdown(); } catch (_) {}
    windows.closeAll();
    try { app.exit(code); } catch (_) {}
    try { process.exit(code); } catch (_) {}
  };
  try {
    await waitDaemonReady();
    step('daemon-ready', true);

    const mainWin = windows.get('main');
    step('main-window', !!mainWin);
    await waitLoad(mainWin);
    step('main-loaded', true);

    const r1 = await daemon.request('app.selfcheck');
    step('selfcheck', r1.ok && r1.result.store && r1.result.store.ok, r1.result && r1.result.store && r1.result.store.mode);

    const s1 = await daemon.request('sessions.create', { title: 'smoke' });
    step('session-create', s1.ok && !!s1.result.id);

    windows.createSettings(); windows.createSearch();
    await new Promise((r) => setTimeout(r, 800));
    step('multi-window', windows.ids().length >= 3, windows.ids().join(','));

    // renderer bridge roundtrip through preload (T18 partially)
    const bridge = await mainWin.webContents.executeJavaScript('window.myagent ? window.myagent.ping() : "no-bridge"', true);
    step('preload-bridge', bridge === 'pong', String(bridge));

    // T29 pixel UI (F29-F33 / design/33 v5.8.2 real UI): tokens, layout, payment exclusion
    const ui = await mainWin.webContents.executeJavaScript(`(() => {
      const cs = getComputedStyle(document.body);
      return {
        brand: cs.getPropertyValue('--brand').trim(),
        side: document.getElementById('sidebar').offsetWidth,
        band: document.getElementById('band').offsetHeight,
      };
    })()`, true);
    step('ui-token', ui.brand === '#00c29a', JSON.stringify(ui));
    // shell = wb v5.8.2: 30px band above a 360px sidebar
    step('ui-shell', ui.side === 360 && ui.band === 30, JSON.stringify(ui));
    // task view: open the smoke session via the renderer hook, then header 64
    await mainWin.webContents.executeJavaScript(
      'window.__myagentTest.openSession(' + JSON.stringify(s1.result.id) + ')', true);
    const ui2 = await mainWin.webContents.executeJavaScript(`(() => ({
      top: document.getElementById('topbar').offsetHeight,
      heroOk: !!document.querySelector('#messages .home-hero') === !document.querySelector('#messages .msg'),
    }))()`, true);
    step('ui-main', ui2.top === 64 && ui2.heroOk, JSON.stringify(ui2));
    // T44 (F44/F45/F48/F49 renderer surfaces): inject engine events through the
    // test hook and assert the wb-parity cards — artifact card, plan card,
    // progress line, tool_result merged in place with fail badge + detail,
    // usage event after done
    const surf = await mainWin.webContents.executeJavaScript(`(async () => {
      const T = window.__myagentTest;
      if (!T || !T.injectEngineEvent) return { err: 'no injectEngineEvent hook' };
      T.injectEngineEvent({ type: 'tool_call', id: 'smoke1', name: 'write_file',
        args: { path: 'X:/a.txt' }, step: 2, maxSteps: 64 });
      await new Promise((r) => setTimeout(r, 50));
      const prog = document.getElementById('progress-line');
      const art = !!document.querySelector('.artifact-card');
      const progOk = !!prog && !prog.classList.contains('hidden') && /第 2\\/64 步/.test(prog.textContent);
      T.injectEngineEvent({ type: 'todo', todos: [{ text: '调研 REA', done: true }, { text: '写报告', done: false }] });
      const rows = document.querySelectorAll('.todo-card .todo-row').length;
      const doneRow = !!document.querySelector('.todo-row.done');
      T.injectEngineEvent({ type: 'tool_result', id: 'smoke1', ok: false, summary: 'web_fetch failed: unreachable', detail: 'boom' });
      const chip = [...document.querySelectorAll('.tool-chip')].find((c) => c.textContent.includes('write_file'));
      const merged = !!chip && chip.textContent.includes('unreachable')
        && !!chip.closest('.msg').querySelector('.tool-fail');
      T.injectEngineEvent({ type: 'done', reason: 'complete', usageTokens: 123 });
      const progHidden = prog.classList.contains('hidden');
      const usage = [...document.querySelectorAll('.sys-event')].some((e) => e.textContent.includes('~123 tokens'));
      return { art, progOk, rows, doneRow, merged, progHidden, usage };
    })()`, true);
    step('ui-tool-surfaces', !surf.err && surf.art && surf.progOk && surf.rows === 2 && surf.doneRow
      && surf.merged && surf.progHidden && surf.usage, JSON.stringify(surf));
    // F54 sidebar = wb v5.8.2 nav: six rows in a 202px block starting at
    // y=96 (wb-live-tokens-main.json navNewTask), session rows carry a time
    const nav = await mainWin.webContents.executeJavaScript(`(() => {
      const nav = document.getElementById('sb-nav');
      const labels = [...nav.querySelectorAll('.nav-item')].map((b) => b.childNodes[1] ? b.childNodes[1].textContent : b.textContent);
      const row = document.querySelector('#session-list li, .session-list-nested li');
      return { labels, h: nav.offsetHeight, top: Math.round(nav.getBoundingClientRect().top),
        time: !!(row && row.querySelector('.sr-time') && row.querySelector('.sr-time').textContent),
        rel: [window.__myagentTest.relTime(Date.now() - 30e3), window.__myagentTest.relTime(Date.now() - 5 * 3600e3)] };
    })()`, true);
    step('ui-nav', nav.labels.join('|') === '新建任务|助理|专家·技能·连接器|定时任务|资料库|更多'
      && nav.h === 202 && nav.top === 96 && nav.time && nav.rel[0] === '刚刚' && nav.rel[1] === '5小时前', JSON.stringify(nav));
    // F53/F54 hub: Claude catalog cards render in the main area and the
    // install button really installs through the daemon
    // smoke runs against the real data dir: click the first card that is not
    // installed yet and uninstall it afterwards so user state is unchanged
    const hubInfo = await mainWin.webContents.executeJavaScript(`(async () => {
      await window.__myagentTest.openHub('skills', 'all');
      const visible = !document.getElementById('hub').classList.contains('hidden')
        && getComputedStyle(document.getElementById('messages')).display === 'none';
      const cards = document.querySelectorAll('#hub-skill-grid .skill-card').length;
      const banner = (document.querySelector('#hub-banner .hub-banner__title') || {}).textContent || '';
      const view = document.querySelector('#hub-skill-grid .skill-card[data-name="pdf"] .sc-act');
      const card = [...document.querySelectorAll('#hub-skill-grid .skill-card')]
        .find((c) => c.querySelector('.sc-act').textContent === '安装');
      if (!card) return { visible, cards, banner, viewOnly: view && view.textContent, picked: null };
      const name = card.dataset.name;
      const sel = '#hub-skill-grid .skill-card[data-name="' + name + '"] .sc-act';
      card.querySelector('.sc-act').click();
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const b = document.querySelector(sel);
        if (b && b.textContent === '已安装') break;
      }
      const after = document.querySelector(sel).textContent;
      document.querySelector('#hub-filters .hub-chip[data-filter="installed"]').click();
      const installedView = [...document.querySelectorAll('#hub-skill-grid .skill-card')].map((c) => c.dataset.name);
      document.querySelector('#hub-filters .hub-chip[data-filter="all"]').click();
      return { visible, cards, banner, viewOnly: view && view.textContent, picked: name, after, installedView };
    })()`, true);
    const hubSkills = await daemon.request('skills.list');
    const picked = hubInfo.picked;
    const installedOk = !picked || (hubInfo.after === '已安装' && hubInfo.installedView.includes(picked)
      && !hubInfo.installedView.includes('pdf') && hubSkills.ok && hubSkills.result.some((s) => s.name === picked));
    if (picked) await daemon.request('skills.uninstall', { name: picked });
    step('ui-hub', hubInfo.visible && hubInfo.cards >= 19 && hubInfo.banner === 'Claude 技能市场'
      && hubInfo.viewOnly === '仅查看' && installedOk, JSON.stringify(hubInfo));
    await mainWin.webContents.executeJavaScript(
      'window.__myagentTest.openSession(' + JSON.stringify(s1.result.id) + ')', true);
    const stWin = windows.get('settings');
    const stNav = await stWin.webContents.executeJavaScript(
      'document.querySelector(".settings-modal__nav").offsetWidth', true).catch(() => null);
    step('ui-settings', stNav === 224, String(stNav));
    const shWin = windows.get('search');
    const shInfo = await shWin.webContents.executeJavaScript(
      '[window.innerWidth, window.innerHeight, document.getElementById("q").offsetHeight]', true).catch(() => null);
    step('ui-search', !!shInfo && shInfo[0] === 800 && shInfo[1] === 640 && shInfo[2] >= 40, JSON.stringify(shInfo));
    const payWords = ['套餐', '积分', '充值', '订阅', '购买', '收银台', '微信支付'];
    const payHits = [];
    // design/27: the exclusion scan covers all four pages — open the preview
    // window on the shared fixture so it is scanned too
    const pvWin = windows.createPreview(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'share-sample.txt'));
    await new Promise((r) => setTimeout(r, 600));
    // F33 geometry: 980×720 window, 32px bar on the #f2f2f2 backdrop
    const pvInfo = await pvWin.webContents.executeJavaScript(
      '[window.innerWidth, window.innerHeight, document.getElementById("preview-bar").offsetHeight, getComputedStyle(document.body).backgroundColor]', true).catch(() => null);
    step('ui-preview', !!pvInfo && pvInfo[0] === 980 && pvInfo[1] === 720 && pvInfo[2] === 32
      && /242,\s*242,\s*242/.test(pvInfo[3]), JSON.stringify(pvInfo));
    // F29 dark tokens end-to-end: setTheme over the real chain (persist +
    // rpc:event app:theme broadcast → renderer applies data-theme)
    await mainWin.webContents.executeJavaScript(
      'window.myagent.windowAction("setTheme", { theme: "dark" })', true);
    await new Promise((r) => setTimeout(r, 400));
    const dark = await mainWin.webContents.executeJavaScript(`(() => {
      const cs = getComputedStyle(document.body);
      return {
        attr: document.body.dataset.theme,
        brand: cs.getPropertyValue('--brand').trim(),
        content: cs.getPropertyValue('--bg-content').trim(),
        side: cs.getPropertyValue('--bg-side').trim(),
        gray2: cs.getPropertyValue('--gray-2').trim(),
      };
    })()`, true);
    step('ui-token-dark', dark.attr === 'dark' && dark.brand === '#4ecba0'
      && dark.content === '#1a1a1a' && dark.side === '#1f1f1f' && dark.gray2 === '#292929', JSON.stringify(dark));
    await mainWin.webContents.executeJavaScript(
      'window.myagent.windowAction("setTheme", { theme: "light" })', true);
    await new Promise((r) => setTimeout(r, 300));

    // F35 native menu: 新建任务 enters the wb draft state (no session created
    // until first send — behavior parity with wb, design/33)
    const beforeCount = (await daemon.request('sessions.list')).result.length;
    const menuItem = Menu.getApplicationMenu() && Menu.getApplicationMenu().getMenuItemById('new-session');
    if (menuItem) menuItem.click();
    await new Promise((r) => setTimeout(r, 1000));
    const menuState = await mainWin.webContents.executeJavaScript(`({
      home: document.getElementById('main').classList.contains('home'),
      count: document.querySelectorAll('#messages .msg').length,
    })`, true).catch(() => null);
    const afterCount = (await daemon.request('sessions.list')).result.length;
    step('menu', !!menuItem && !!menuState && menuState.home === true && menuState.count === 0 && afterCount === beforeCount,
      JSON.stringify({ accelerator: menuItem ? menuItem.accelerator : null, menuState, before: beforeCount, after: afterCount }));

    // F36 splash handoff: created before the main window, closed on its load
    step('splash-handoff', (() => { const s = splash.getState(); return s.created === true && s.closed === true; })(),
      JSON.stringify(splash.getState()));

    // F34 MCP server lifecycle over daemon RPC
    const mcpStart = await daemon.request('mcp.start');
    const mcpRun = await daemon.request('mcp.status');
    const mcpStop = await daemon.request('mcp.stop');
    step('mcp-status', mcpStart.ok && mcpStart.result.running === true
      && mcpRun.ok && mcpRun.result.running === true && mcpStop.ok,
      JSON.stringify({ start: mcpStart.result, run: mcpRun.result }));

    for (const w of [mainWin, stWin, shWin, pvWin]) {
      if (!w || w.isDestroyed()) continue;
      const txt = await w.webContents.executeJavaScript('document.body.innerText', true).catch(() => '');
      for (const kw of payWords) if (txt.includes(kw)) payHits.push(kw);
    }
    step('ui-paywall-zero', payHits.length === 0, payHits.join(','));

    // deeplink queue (T16): register capture synchronously, then deliver
    await mainWin.webContents.executeJavaScript(
      'window.__cap=[]; window.myagent.onEvent((ev)=>{ if(ev.topic==="app:pendingUrls") window.__cap.push(...ev.payload); }); "armed"', true);
    queueDeeplink('myagent://session/' + s1.result.id);
    let got = 'timeout';
    for (let i = 0; i < 20; i++) {
      const c = await mainWin.webContents.executeJavaScript('window.__cap', true);
      if (c.length) { got = c; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    step('deeplink-consumed', Array.isArray(got) && got.length === 1 && got[0].action === 'session', JSON.stringify(got));

    // tray created
    step('tray', !!tray);

    // renderer XSS guard sample (T17 partial, full render test in page)
    const xss = await mainWin.webContents.executeJavaScript(
      `window.__renderTest ? window.__renderTest('<img src=x onerror=window.__pwned=1><script>window.__pwned=1</script>') : 'no-test-hook'`, true);
    step('render-sanitize', xss && xss.pwned === false, JSON.stringify(xss));

    // T19 mermaid render pipeline (F19)
    const mmd = await mainWin.webContents.executeJavaScript(
      "window.__mermaidTest ? window.__mermaidTest('```mermaid\\ngraph TD; A-->B;\\n```') : 'no-hook'", true);
    step('mermaid-render', mmd && mmd.svg === true && mmd.errors === 0, JSON.stringify(mmd));

    // T20 preview: sandbox-checked binary read + preview window decode (F20)
    const fx = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'share-sample.txt');
    fs.mkdirSync(path.dirname(fx), { recursive: true });
    if (!fs.existsSync(fx)) fs.writeFileSync(fx, 'T20 fixture content\n');
    const rb = await daemon.request('files.readBinary', { path: fx });
    step('preview-readbinary', rb.ok && !!rb.result.base64
      && Buffer.from(rb.result.base64, 'base64').toString('utf8').includes('T20 fixture'),
    rb.ok ? rb.result.mime : JSON.stringify(rb.error));
    const pv = windows.createPreview(fx);
    await waitLoad(pv).catch(() => {});
    let pvState = null;
    for (let i = 0; i < 25 && !(pvState && pvState.ok); i++) {
      pvState = await pv.webContents.executeJavaScript('window.__previewState || null', true).catch(() => null);
      await new Promise((r) => setTimeout(r, 200));
    }
    step('preview-window', windows.ids().length >= 4 && pvState && pvState.ok === true && pvState.kind === 'text', JSON.stringify(pvState));

    // T21 updater status fields (F21, no external calls)
    const us = await mainWin.webContents.executeJavaScript('window.myagent.windowAction("updateState")', true);
    step('updater-status', us && typeof us.enabled === 'boolean' && typeof us.currentVersion === 'string'
      && 'manifest' in us && 'stage' in us, JSON.stringify(us && { enabled: us.enabled, stage: us.stage, v: us.currentVersion }));

    // T22 browser tool availability probe (F22)
    const scFull = await daemon.request('app.selfcheck');
    step('browser-tool', scFull.ok && scFull.result.browser && typeof scFull.result.browser.available === 'boolean',
      scFull.result.browser ? String(scFull.result.browser.channel) + '/' + String(scFull.result.browser.available) : 'missing');

    // T23 IM channel table (F23)
    const im = await daemon.request('im.status');
    step('im-status', im.ok && Array.isArray(im.result) && im.result.some((c) => c.id === 'telegram')
      && im.result.some((c) => c.id === 'webhook'), im.ok ? im.result.map((c) => c.id).join(',') : JSON.stringify(im.error));

    // T25 market status (F25)
    const mk = await daemon.request('market.status');
    step('market-status', mk.ok && mk.result && Array.isArray(mk.result.sources) && typeof mk.result.allowInsecure === 'boolean', null);

    // T26 sync status (F26)
    const sy = await daemon.request('sync.status');
    step('sync-status', sy.ok && sy.result && 'auto' in sy.result && 'dirty' in sy.result, null);

    // T27 capability matrix carries phase-4 fields (F27)
    step('phase4-fields', scFull.ok && scFull.result.browser && scFull.result.im && scFull.result.market
      && scFull.result.sync && scFull.result.a2a, null);

    // T28 a2a card over loopback (F28)
    const a2aOn = await daemon.request('a2a.enable', { enabled: true });
    let cardOk = false; let cardName = '';
    if (a2aOn.ok && a2aOn.result && a2aOn.result.url) {
      try {
        const res = await fetch(a2aOn.result.url + '/.well-known/agent.json');
        cardOk = res.status === 200;
        cardName = (await res.json()).name;
      } catch (_) {}
    }
    step('a2a-card', cardOk && cardName === 'MyAgent', cardName);
    await daemon.request('a2a.enable', { enabled: false }).catch(() => {});

    // T24 share argv (F24): run the share entrypoint like the MSIX helper would
    if (process.env.MYAGENT_SMOKE_SHARE) {
      await handleShare(process.env.MYAGENT_SMOKE_SHARE);
      await new Promise((r) => setTimeout(r, 500));
      const sl = await daemon.request('sessions.list');
      const shared = sl.ok && sl.result.find((s) => String(s.title).startsWith('Shared: '));
      step('share-argv', !!shared, shared && shared.title);
    }
  } catch (e) {
    step('exception', false, String(e && e.stack || e));
  }
  finishSmoke();
}

function waitDaemonReady() {
  if (daemon.ready) return Promise.resolve();
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('daemon not ready in 20s')), 20000);
    daemon.on('ready', () => { clearTimeout(t); res(); });
  });
}

function waitLoad(win) {
  if (!win) return Promise.reject(new Error('no window'));
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise((res) => win.webContents.once('did-finish-load', res));
}
