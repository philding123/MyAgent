'use strict';
// Electron main entry (F01/F02/F16). Narrow IPC surface: one 'rpc' handle +
// event broadcast, window controls, deeplink queue, smoke-test hook.

const { app, ipcMain, dialog, BrowserWindow } = require('electron');
const { DaemonClient } = require('./daemon-client');
const windows = require('./windows');
const { createTray, parseDeeplink } = require('./tray');
const fs = require('fs');
const path = require('path');

let daemon;
let tray = null;
let smokeResult = { steps: [], ok: true };
const pendingUrls = [];

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => String(a).startsWith('myagent://'));
    if (url) queueDeeplink(url);
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
  ipcMain.handle('rpc.window', (_e, req) => {
    if (req.action === 'openSettings') windows.createSettings();
    if (req.action === 'openSearch') windows.createSearch();
    if (req.action === 'setTheme') windows.setTheme(req.theme);
    if (req.action === 'theme') return windows.theme();
    if (req.action === 'pickDirectory') {
      return dialog.showOpenDialog({ properties: ['openDirectory'] }).then((r) => (r.canceled ? null : r.filePaths[0]));
    }
    return null;
  });

  daemon.on('event', (msg) => windows.broadcast('rpc:event', { topic: msg.topic, payload: msg.payload }));
  daemon.on('ready', () => deliverPendingUrls());
  daemon.on('down', () => windows.broadcast('rpc:event', { topic: 'daemon:status', payload: { state: 'reconnecting' } }));

  tray = createTray(require('electron'), {
    showMain: () => { const w = windows.createMain(null); w.show(); },
    quit: () => { global.__myagentQuitting = true; app.quit(); },
  });

  windows.createMain({ onCreated: (_name, win) => { win.webContents.on('did-finish-load', deliverPendingUrls); } });

  // cold-start deeplink from argv (Windows)
  const url = process.argv.find((a) => String(a).startsWith('myagent://'));
  if (url) queueDeeplink(url);

  app.on('activate', () => windows.createMain(null));
  app.on('before-quit', () => { global.__myagentQuitting = true; });
  app.on('window-all-closed', () => {
    if (process.env.MYAGENT_SMOKE || process.platform !== 'win32') app.quit();
  });

  if (process.env.MYAGENT_SMOKE) runSmoke();
}

/** E2E smoke (T01/T16/T17/T18 core): run assertions headless-ish, write JSON, exit. */
async function runSmoke() {
  const watchdog = setTimeout(() => finishSmoke(), 90000);
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
