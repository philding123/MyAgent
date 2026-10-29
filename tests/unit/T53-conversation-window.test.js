'use strict';
// T53 (F37 conversation window, design/41): windows.js createConversation —
// wb parity is single-instance + reuse-re-target; selfAction is the
// non-main-window in-DOM control path. electron is stubbed via require.cache
// so the module under test runs headless.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

class FakeWebContents {
  constructor(win) { this.win = win; this.sent = []; }
  send(channel, payload) { this.sent.push({ channel, payload }); }
}

class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts;
    this.webContents = new FakeWebContents(this);
    this.loaded = null;
    this.handlers = new Map();
    this.focused = 0; this.minimized = 0; this.maximized = 0; this.unmaximized = 0;
    this.closed = 0; this.destroyed = false; this.isMaximizedValue = false;
    FakeBrowserWindow.created.push(this);
  }
  loadFile(file, opts) { this.loaded = { file, opts }; }
  on(ev, fn) { this.handlers.set(ev, fn); }
  focus() { this.focused++; }
  minimize() { this.minimized++; }
  maximize() { this.maximized++; }
  unmaximize() { this.unmaximized++; }
  close() { this.closed++; }
  destroy() { this.destroyed = true; }
  isMaximized() { return this.isMaximizedValue; }
  isDestroyed() { return this.destroyed; }
  isVisible() { return true; }
  simulateClosed() { const fn = this.handlers.get('closed'); if (fn) fn(); }
}
FakeBrowserWindow.created = [];

const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { BrowserWindow: FakeBrowserWindow } };
const windows = require('../../app/main/windows');

const RENDERER_INDEX = path.join(__dirname, '..', '..', 'app', 'renderer', 'index.html');

test('T53 createConversation opens one 640x800 frameless window pinned to the session', () => {
  const w = windows.createConversation('s1');
  assert.equal(FakeBrowserWindow.created.length, 1);
  assert.equal(w.opts.width, 640); assert.equal(w.opts.height, 800);
  assert.equal(w.opts.minWidth, 480); assert.equal(w.opts.minHeight, 600);
  assert.equal(w.opts.frame, false);
  assert.equal(w.loaded.file, RENDERER_INDEX);
  assert.equal(w.loaded.opts.search, '?windowKind=conversation&session=s1');
  assert.ok(windows.ids().includes('conversation'));
});

test('T53 reuse focuses and re-targets via app:pendingUrls instead of a second window', () => {
  const first = FakeBrowserWindow.created[0];
  const w = windows.createConversation('s2');
  assert.equal(w, first, 'single instance — wb instancePolicy single');
  assert.equal(FakeBrowserWindow.created.length, 1);
  assert.equal(first.focused, 1);
  assert.deepEqual(first.webContents.sent, [
    { channel: 'rpc:event', payload: { topic: 'app:pendingUrls', payload: [{ action: 'session', id: 's2' }] } },
  ]);
});

test('T53 reuse without a session id never injects a pendingUrls re-target', () => {
  const first = FakeBrowserWindow.created[0];
  first.webContents.sent.length = 0;
  windows.createConversation('');
  assert.equal(first.webContents.sent.length, 0);
  assert.equal(FakeBrowserWindow.created.length, 1);
});

test('T53 closing the conversation window frees the slot for the next open', () => {
  FakeBrowserWindow.created[0].simulateClosed();
  assert.equal(windows.ids().includes('conversation'), false);
  const w = windows.createConversation('s3');
  assert.equal(FakeBrowserWindow.created.length, 2);
  assert.match(w.loaded.opts.search, /session=s3$/);
});

test('T53 selfAction drives only the calling window; unknown op and null window are no-ops', () => {
  const win = FakeBrowserWindow.created[1];
  assert.equal(windows.selfAction(win, 'minimize'), 'minimize');
  assert.equal(win.minimized, 1);
  win.isMaximizedValue = true;
  assert.equal(windows.selfAction(win, 'maximize'), 'maximize');
  assert.equal(win.unmaximized, 1); assert.equal(win.maximized, 0);
  win.isMaximizedValue = false;
  windows.selfAction(win, 'maximize');
  assert.equal(win.maximized, 1);
  assert.equal(windows.selfAction(win, 'close'), 'close');
  assert.equal(win.closed, 1);
  assert.equal(windows.selfAction(win, 'nonsense'), 'nonsense');
  assert.equal(win.closed, 1, 'unknown op performs nothing');
  assert.equal(windows.selfAction(null, 'close'), null);
});
