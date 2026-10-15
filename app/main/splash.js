'use strict';
// F36 splash (design/32-splash.md): wb shows an 800x500 frameless branded
// window first (resolveSplashPreload / main/splash/splash.html) and hands off
// to the main window. Pure shell — no network, no bundle.

const path = require('path');
const { BrowserWindow } = require('electron');

const state = { created: false, closed: false };
let win = null;

function createSplash() {
  win = new BrowserWindow({
    width: 800,
    height: 500,
    resizable: false,
    frame: false,
    show: !process.env.MYAGENT_SMOKE,
    title: 'MyAgent',
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  state.created = true;
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
  return win;
}

function closeSplash() {
  state.closed = true;
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

function getState() {
  return { created: state.created, closed: state.closed };
}

module.exports = { createSplash, closeSplash, getState };
