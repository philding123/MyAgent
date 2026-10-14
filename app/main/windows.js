'use strict';
// Window registry (F01): main / settings / search windows, singleton reuse,
// cross-window theme sync, tray-aware close behavior (F16).

const path = require('path');
const { BrowserWindow } = require('electron');

const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

const windows = new Map();

function theme() {
  // simple 2-theme system; nativeTheme could drive 'system'
  return global.__myagentTheme || 'dark';
}

function baseOpts(title, size) {
  return {
    title,
    width: size[0],
    height: size[1],
    show: !process.env.MYAGENT_SMOKE, // smoke tests keep windows hidden
    backgroundColor: theme() === 'dark' ? '#101418' : '#f7f8fa',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  };
}

function createMain(deps) {
  if (windows.has('main')) return windows.get('main');
  const win = new BrowserWindow({ ...baseOpts('MyAgent', [1200, 800]), autoHideMenuBar: true });
  win.loadFile(path.join(RENDERER, 'index.html'));
  win.on('closed', () => windows.delete('main'));
  win.on('close', (e) => {
    // close-to-tray for the main window (personal-use choice, F16)
    if (!global.__myagentQuitting && process.platform === 'win32' && !process.env.MYAGENT_SMOKE) {
      e.preventDefault();
      win.hide();
    }
  });
  windows.set('main', win);
  deps && deps.onCreated && deps.onCreated('main', win);
  return win;
}

function createSettings() {
  if (windows.has('settings')) { windows.get('settings').focus(); return windows.get('settings'); }
  const win = new BrowserWindow({ ...baseOpts('MyAgent Settings', [760, 620]), autoHideMenuBar: true });
  win.loadFile(path.join(RENDERER, 'settings.html'));
  win.on('closed', () => windows.delete('settings'));
  windows.set('settings', win);
  return win;
}

function createSearch() {
  if (windows.has('search')) { windows.get('search').focus(); return windows.get('search'); }
  const win = new BrowserWindow({ ...baseOpts('Global Search', [720, 520]), autoHideMenuBar: true, frame: false });
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
