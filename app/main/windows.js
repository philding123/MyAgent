'use strict';
// Window registry (F01): main / settings / search windows, singleton reuse,
// cross-window theme sync, tray-aware close behavior (F16).

const path = require('path');
const { BrowserWindow } = require('electron');

const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

const windows = new Map();

function theme() {
  // WorkBuddy default is IDE Light (design/27-pixel-ui F29); simple 2-theme system
  return global.__myagentTheme || 'light';
}

function baseOpts(title, size) {
  return {
    title,
    width: size[0],
    height: size[1],
    show: !process.env.MYAGENT_SMOKE, // smoke tests keep windows hidden
    backgroundColor: theme() === 'dark' ? '#1f1f1f' : '#ffffff',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  };
}

function createMain(deps) {
  if (windows.has('main')) return windows.get('main');
  const win = new BrowserWindow({ ...baseOpts('MyAgent', [1200, 800]), autoHideMenuBar: true });
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

function createSettings() {
  if (windows.has('settings')) { windows.get('settings').focus(); return windows.get('settings'); }
  const win = new BrowserWindow({ ...baseOpts('MyAgent Settings', [880, 640]), autoHideMenuBar: true });
  win.loadFile(path.join(RENDERER, 'settings.html'));
  win.on('closed', () => windows.delete('settings'));
  windows.set('settings', win);
  return win;
}

function createSearch() {
  if (windows.has('search')) { windows.get('search').focus(); return windows.get('search'); }
  // 800×640 command palette (WorkBuddy global-search window, design/27 F32)
  const win = new BrowserWindow({ ...baseOpts('Global Search', [800, 640]), autoHideMenuBar: true, frame: false });
  win.loadFile(path.join(RENDERER, 'search.html'));
  win.on('closed', () => windows.delete('search'));
  windows.set('search', win);
  return win;
}

// F20: document preview window. One window per file path (reused when the
// same file is previewed again).
function createPreview(filePath) {
  const key = 'preview:' + filePath;
  if (windows.has(key)) { windows.get(key).focus(); return windows.get(key); }
  const win = new BrowserWindow({ ...baseOpts('MyAgent Preview', [980, 720]), autoHideMenuBar: true });
  win.loadFile(path.join(RENDERER, 'preview.html'), { search: '?path=' + encodeURIComponent(filePath) });
  win.on('closed', () => windows.delete(key));
  windows.set(key, win);
  return win;
}

function broadcast(channel, payload) {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function setTheme(t) {
  global.__myagentTheme = t;
  broadcast('appearance', { theme: t });
}

function ids() { return [...windows.keys()]; }
function get(name) { return windows.get(name) || null; }
function closeAll() { for (const w of windows.values()) w.destroy(); windows.clear(); }

module.exports = { createMain, createSettings, createSearch, createPreview, broadcast, setTheme, theme, ids, get, closeAll };
