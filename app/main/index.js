'use strict';
// Electron main entry (F01/F02/F16). Narrow IPC surface: one 'rpc' handle +
// event broadcast, window controls, deeplink queue, smoke-test hook.

const { app, ipcMain, dialog, BrowserWindow } = require('electron');
const { DaemonClient } = require('./daemon-client');
const windows = require('./windows');
const { createTray, parseDeeplink } = require('./tray');
const { Updater } = require('./updater');
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
  daemon = new DaemonClient();
  daemon.start();

  ipcMain.handle('rpc', (_e, req) => daemon.request(req.method, req.params));
  ipcMain.handle('rpc.window', async (_e, req) => {
    if (req.action === 'openSettings') windows.createSettings();
    if (req.action === 'openSearch') windows.createSearch();
    if (req.action === 'openPreview' && req.path) windows.createPreview(String(req.path));
    if (req.action === 'pickFile') {
      return dialog.showOpenDialog({ properties: ['openFile'] }).then((r) => (r.canceled ? null : r.filePaths[0]));
    }
    if (req.action === 'setTheme') windows.setTheme(req.theme);
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
    return null;
  });

  daemon.on('event', (msg) => windows.broadcast('rpc:event', { topic: msg.topic, payload: msg.payload }));
  daemon.on('ready', () => deliverPendingUrls());
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

  windows.createMain({ onCreated: (_name, win) => { win.webContents.on('did-finish-load', deliverPendingUrls); } });

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

    // T29 pixel UI (F29-F33, design/27-pixel-ui.md): tokens, layout, payment exclusion
    const ui = await mainWin.webContents.executeJavaScript(`(() => {
      const cs = getComputedStyle(document.body);
      return {
        brand: cs.getPropertyValue('--brand').trim(),
        side: document.getElementById('sidebar').offsetWidth,
        top: document.getElementById('topbar').offsetHeight,
        heroOk: !!document.querySelector('#messages .home-hero') === !document.querySelector('#messages .msg'),
      };
    })()`, true);
    step('ui-token', ui.brand === '#00c29a', JSON.stringify(ui));
    step('ui-main', ui.side === 220 && ui.top === 48 && ui.heroOk, JSON.stringify(ui));
    const stWin = windows.get('settings');
    const stNav = await stWin.webContents.executeJavaScript(
      'document.querySelector(".settings-modal__nav").offsetWidth', true).catch(() => null);
    step('ui-settings', stNav === 200, String(stNav));
    const shWin = windows.get('search');
    const shInfo = await shWin.webContents.executeJavaScript(
      '[window.innerWidth, window.innerHeight, document.getElementById("q").offsetHeight]', true).catch(() => null);
    step('ui-search', !!shInfo && shInfo[0] === 800 && shInfo[1] === 640 && shInfo[2] >= 40, JSON.stringify(shInfo));
    const payWords = ['套餐', '积分', '充值', '订阅', '购买', '收银台', '微信支付'];
    const payHits = [];
    for (const w of [mainWin, stWin, shWin]) {
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
