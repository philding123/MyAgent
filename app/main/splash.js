'use strict';
// F36 splash (design/32-splash.md): wb shows an 800x500 frameless branded
// window first (resolveSplashPreload / main/splash/splash.html) and hands off
// to the main window. Pure shell — no network, no bundle.

const path = require('path');
const { BrowserWindow } = require('electron');

const state = { created: false, closed: false };
let win = null;

function createSplash() {
  // F60 (design/44 §6): compact 560×360 card in the app's warm palette
  const dark = global.__myagentTheme === 'dark';
  win = new BrowserWindow({
    width: 560,
    height: 360,
    resizable: false,
    frame: false,
    show: false,
    title: 'MyAgent',
    backgroundColor: dark ? '#1b1a18' : '#fbfaf7',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  state.created = true;
  win.on('closed', () => { win = null; });
  win.once('ready-to-show', () => { if (!process.env.MYAGENT_SMOKE && win && !win.isDestroyed()) win.show(); });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'), { search: dark ? '?theme=dark' : '' });
  return win;
}

// hand-off fades the splash out where window opacity is supported
function closeSplash() {
  state.closed = true;
  const w = win;
  win = null;
  if (!w || w.isDestroyed()) return;
  if (!w.isVisible() || !(process.platform === 'win32' || process.platform === 'darwin')) { w.destroy(); return; }
  let opacity = 1;
  const timer = setInterval(() => {
    if (w.isDestroyed()) { clearInterval(timer); return; }
    opacity -= 0.2;
    if (opacity <= 0) { clearInterval(timer); w.destroy(); } else w.setOpacity(opacity);
  }, 16);
}

function getState() {
  return { created: state.created, closed: state.closed };
}

module.exports = { createSplash, closeSplash, getState };
