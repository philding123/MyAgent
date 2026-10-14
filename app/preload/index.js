'use strict';
// Preload bridge: the only renderer-facing surface. Narrow by design
// (mirrors WorkBuddy's narrow IPC + wb:invoke bus).

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

contextBridge.exposeInMainWorld('myagent', {
  invoke: (method, params) => ipcRenderer.invoke('rpc', { method, params }),
  windowAction: (action, extra) => ipcRenderer.invoke('rpc.window', { action, ...(extra || {}) }),
  onEvent: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  ping: () => 'pong',
  platform: process.platform,
});

ipcRenderer.on('rpc:event', (_e, msg) => { for (const fn of [...listeners]) fn(msg); });
