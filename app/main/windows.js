'use strict';
// Window registry (F01): main / settings / search windows, singleton reuse,
// cross-window theme sync, tray-aware close behavior (F16).

const path = require('path');
const { BrowserWindow } = require('electron');

const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

const windows = new Map();

function theme() {
  // simple 2-theme system, light by default (F29)
  return global.__myagentTheme || 'light';
}

// F60 (design/44 §5): window background = the page's --bg-content token, so
// the frame before first paint is the same color as the page, not white
const BG = { light: '#fbfaf7', dark: '#1b1a18' };
const CAN_FADE = process.platform === 'win32' || process.platform === 'darwin';
// transparent windows need a compositor; Linux desktops vary, so only
// win32/darwin get the floating search palette
const CAN_FLOAT = CAN_FADE;

function baseOpts(title, size) {
  return {
    title,
    width: size[0],
    height: size[1],
    show: false, // revealed on ready-to-show (present); smoke tests stay hidden
    backgroundColor: BG[theme()] || BG.light,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  };
}

// Show a window once its first frame is ready, fading in where the platform
// supports window opacity. MYAGENT_SMOKE keeps every window hidden.
function present(win) {
  win.once('ready-to-show', () => {
    if (process.env.MYAGENT_SMOKE || win.isDestroyed()) return;
    if (!CAN_FADE) { win.show(); return; }
    win.setOpacity(0);
    win.show();
    let step = 0;
    const timer = setInterval(() => {
      if (win.isDestroyed()) { clearInterval(timer); return; }
      step++;
      win.setOpacity(Math.min(1, step / 8));
      if (step >= 8) clearInterval(timer);
    }, 16);
  });
  return win;
}

// Child windows open over the main window (centred horizontally, in its
// upper third) instead of wherever the OS drops them. Nothing to anchor to
// when main is hidden (tray / smoke): fall back to the OS default.
function anchoredTo(size, topRatio) {
  const main = windows.get('main');
  if (!main || main.isDestroyed() || !main.isVisible() || main.isMinimized()) return {};
  const b = main.getBounds();
  return {
    parent: main,
    x: Math.round(b.x + (b.width - size[0]) / 2),
    y: Math.round(b.y + Math.max(36, (b.height - size[1]) * topRatio)),
  };
}

function createMain(deps) {
  if (windows.has('main')) return windows.get('main');
  // F38: frameless like wb v5.8.2 — the in-DOM band owns menu labels and
  // min/max/close (rpc.window win-* actions)
  const win = new BrowserWindow({ ...baseOpts('MyAgent', [1200, 800]), autoHideMenuBar: true, frame: false, minWidth: 720, minHeight: 520 });
  present(win);
  win.loadFile(path.join(RENDERER, 'index.html'));
  win.on('closed', () => windows.delete('main'));
  win.on('close', (e) => {
    // close-to-tray for the main window (personal-use choice, F16). Only hide
    // when a tray actually exists — hiding without a tray leaves no way back.
    if (!global.__myagentQuitting && process.platform === 'win32' && !process.env.MYAGENT_SMOKE && global.__myagentTray) {
      e.preventDefault();
      win.hide();
      if (!global.__myagentTrayAnnounced) {
        global.__myagentTrayAnnounced = true;
        try {
          global.__myagentTray.displayBalloon({
            title: 'MyAgent 仍在运行',
            content: '已最小化到托盘（任务栏右下角 ^ 隐藏图标区），点击托盘图标恢复',
            iconType: 'info',
          });
        } catch (_) {}
      }
    }
  });
  windows.set('main', win);
  deps && deps.onCreated && deps.onCreated('main', win);
  return win;
}

function createSettings(panel) {
  if (windows.has('settings')) {
    // already open: switch to the requested panel too, not just focus it
    const w = windows.get('settings');
    if (panel) w.webContents.send('rpc:event', { topic: 'settings:panel', payload: { panel } });
    w.focus();
    return w;
  }
  // 900×680 (design/27 F31); frameless — the in-DOM chrome owns the close
  // button; owned by and centred over the main window (design/44 §5)
  const size = [900, 680];
  const win = new BrowserWindow({ ...baseOpts('MyAgent Settings', size), ...anchoredTo(size, 0.35),
    autoHideMenuBar: true, frame: false, minWidth: 720, minHeight: 520 });
  present(win);
  win.loadFile(path.join(RENDERER, 'settings.html'), { search: panel ? '?panel=' + encodeURIComponent(panel) : '' });
  win.on('closed', () => windows.delete('settings'));
  windows.set('settings', win);
  return win;
}

function createSearch() {
  if (windows.has('search')) { windows.get('search').focus(); return windows.get('search'); }
  // F60 command palette (design/44 §4): 720×480 over the main window's upper
  // area; transparent + self-drawn rounded panel where the platform allows
  const size = [720, 480];
  const win = new BrowserWindow({
    ...baseOpts('Global Search', size), ...anchoredTo(size, 0.18),
    autoHideMenuBar: true, frame: false, resizable: false, maximizable: false, minimizable: false,
    ...(CAN_FLOAT ? { transparent: true, backgroundColor: '#00000000', hasShadow: false } : {}),
  });
  present(win);
  win.loadFile(path.join(RENDERER, 'search.html'), { search: CAN_FLOAT ? '?floating=1' : '' });
  win.on('closed', () => windows.delete('search'));
  // a palette goes away when focus leaves it; test harnesses drive several
  // windows at once, so they keep it open
  if (!process.env.MYAGENT_SMOKE && !process.env.MYAGENT_TEST_SEAMS) {
    win.on('blur', () => { if (!win.isDestroyed()) win.close(); });
  }
  windows.set('search', win);
  return win;
}

// F20/F33: document preview window. One window per file path (reused when the
// same file is previewed again). 980×720 content area; frameless with its own
// title bar (design/44 §4). Not owned by main — a document may sit behind it —
// but it opens over main like the other windows.
function createPreview(filePath) {
  const key = 'preview:' + filePath;
  if (windows.has(key)) { windows.get(key).focus(); return windows.get(key); }
  const size = [980, 720];
  const { x, y } = anchoredTo(size, 0.3);
  const win = new BrowserWindow({ ...baseOpts('MyAgent Preview', size), ...(x !== undefined ? { x, y } : {}),
    autoHideMenuBar: true, useContentSize: true, frame: false, minWidth: 480, minHeight: 360 });
  present(win);
  win.loadFile(path.join(RENDERER, 'preview.html'), { search: '?path=' + encodeURIComponent(filePath) });
  win.on('closed', () => windows.delete(key));
  windows.set(key, win);
  return win;
}

// F37 conversation window (design/41): one reusable, re-targetable session
// surface — wb `conversation` window-app is single-instance and navigated via
// postMessage after open, so reuse focuses + re-targets instead of spawning.
function createConversation(sessionId) {
  const target = String(sessionId || '');
  if (windows.has('conversation')) {
    const w = windows.get('conversation');
    w.focus();
    if (target) {
      // re-target through the existing pendingUrls pipeline (renderer
      // handlePendingUrls → openSession), delivered to this window only
      w.webContents.send('rpc:event', { topic: 'app:pendingUrls', payload: [{ action: 'session', id: target }] });
    }
    return w;
  }
  // wb sizes: 640×800, min 480×600; frameless like the other app windows
  const win = new BrowserWindow({ ...baseOpts('MyAgent', [640, 800]), autoHideMenuBar: true, frame: false, minWidth: 480, minHeight: 600 });
  present(win);
  win.loadFile(path.join(RENDERER, 'index.html'), { search: '?windowKind=conversation' + (target ? '&session=' + encodeURIComponent(target) : '') });
  win.on('closed', () => windows.delete('conversation'));
  windows.set('conversation', win);
  return win;
}

// F37: in-DOM controls of a non-main window act on THAT window (the caller
// resolves it via BrowserWindow.fromWebContents(e.sender) in index.js)
function selfAction(win, op) {
  if (!win) return null;
  if (op === 'minimize') win.minimize();
  else if (op === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (op === 'close') win.close();
  return op;
}

function broadcast(channel, payload) {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function setTheme(t) {
  global.__myagentTheme = t;
  for (const w of windows.values()) {
    // transparent windows must keep a clear background
    if (!w.isDestroyed() && !(CAN_FLOAT && w === windows.get('search'))) w.setBackgroundColor(BG[t] || BG.light);
  }
  // rpc:event envelope so the preload onEvent bridge delivers it (F29 dark
  // theme end-to-end); topic documented in the contract table
  broadcast('rpc:event', { topic: 'app:theme', payload: { theme: t } });
}

function ids() { return [...windows.keys()]; }
function get(name) { return windows.get(name) || null; }
function closeAll() { for (const w of windows.values()) w.destroy(); windows.clear(); }

module.exports = { createMain, createSettings, createSearch, createPreview, createConversation, selfAction, broadcast, setTheme, theme, ids, get, closeAll };
