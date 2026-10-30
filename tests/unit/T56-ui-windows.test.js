'use strict';
// T56 (F60 UI refresh, design/44 §5): window presentation in windows.js —
// windows are created hidden and revealed on ready-to-show (no blank-frame
// flash), smoke mode never reveals, child windows open over a visible main
// window as its children, the search palette has the 720×480 spec, and a
// theme switch repaints every window background. electron is stubbed via
// require.cache so the module runs headless.

const test = require('node:test');
const assert = require('node:assert/strict');

class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts;
    this.webContents = { sent: [], send(channel, payload) { this.sent.push({ channel, payload }); } };
    this.handlers = new Map();
    this.shown = 0; this.destroyed = false; this.visible = false; this.bg = opts.backgroundColor;
    this.bounds = { x: 100, y: 50, width: 1200, height: 800 };
    FakeBrowserWindow.created.push(this);
  }
  loadFile(file, opts) { this.loaded = { file, opts }; }
  on(ev, fn) { this.handlers.set(ev, fn); }
  once(ev, fn) { this.handlers.set(ev, fn); }
  emit(ev) { const fn = this.handlers.get(ev); if (fn) fn(); }
  show() { this.shown++; this.visible = true; }
  focus() {}
  close() { this.emit('closed'); }
  setOpacity(v) { this.opacity = v; }
  setBackgroundColor(c) { this.bg = c; }
  getBounds() { return this.bounds; }
  isVisible() { return this.visible; }
  isMinimized() { return false; }
  isDestroyed() { return this.destroyed; }
}
FakeBrowserWindow.created = [];

const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { BrowserWindow: FakeBrowserWindow } };
const windows = require('../../app/main/windows');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('T56 windows start hidden on the page color and appear only at ready-to-show', () => {
  withEnv({ MYAGENT_SMOKE: null }, () => {
    const main = windows.createMain(null);
    assert.equal(main.opts.show, false, 'never visible before the first frame');
    assert.equal(main.opts.backgroundColor, '#fbfaf7', 'pre-paint color = --bg-content');
    assert.equal(main.shown, 0);
    main.emit('ready-to-show');
    assert.equal(main.shown, 1, 'revealed on ready-to-show');
  });
});

test('T56 smoke mode never reveals a window', () => {
  withEnv({ MYAGENT_SMOKE: '1' }, () => {
    const pv = windows.createPreview('/tmp/t56-smoke.txt');
    pv.emit('ready-to-show');
    assert.equal(pv.shown, 0);
    assert.equal(pv.opts.frame, false, 'preview is frameless with its own title bar');
    pv.close();
  });
});

test('T56 settings and search open as children centred over a visible main window', () => {
  withEnv({ MYAGENT_SMOKE: null, MYAGENT_TEST_SEAMS: '1' }, () => {
    const main = windows.get('main');
    main.visible = true;
    const st = windows.createSettings();
    assert.equal(st.opts.parent, main, 'settings is owned by main');
    assert.equal(st.opts.x, 100 + (1200 - 900) / 2, 'centred horizontally over main');
    assert.ok(st.opts.y >= 50 && st.opts.y < 50 + 800 - 680, 'inside main vertically');
    const sh = windows.createSearch();
    assert.equal(sh.opts.parent, main);
    assert.deepEqual([sh.opts.width, sh.opts.height], [720, 480], 'palette spec');
    assert.equal(sh.opts.resizable, false);
    const floating = process.platform === 'win32' || process.platform === 'darwin';
    assert.equal(!!sh.opts.transparent, floating, 'transparent only where a compositor is guaranteed');
    assert.equal(sh.loaded.opts.search, floating ? '?floating=1' : '');
    assert.ok(!sh.handlers.has('blur'), 'test seams keep the palette open on blur');
    st.close(); sh.close();
  });
});

test('T56 the search palette closes when it loses focus', () => {
  withEnv({ MYAGENT_SMOKE: null, MYAGENT_TEST_SEAMS: null }, () => {
    const sh = windows.createSearch();
    let closed = 0;
    sh.close = () => { closed++; sh.emit('closed'); };
    sh.emit('blur');
    assert.equal(closed, 1);
    assert.ok(!windows.ids().includes('search'));
  });
});

test('T56 a hidden main window anchors nothing: OS default placement, no owner', () => {
  withEnv({ MYAGENT_SMOKE: null, MYAGENT_TEST_SEAMS: '1' }, () => {
    windows.get('main').visible = false;
    const st = windows.createSettings();
    assert.equal(st.opts.parent, undefined);
    assert.equal(st.opts.x, undefined);
    st.close();
  });
});

test('T56 a theme switch repaints window backgrounds', () => {
  const main = windows.get('main');
  windows.setTheme('dark');
  assert.equal(main.bg, '#1b1a18');
  windows.setTheme('light');
  assert.equal(main.bg, '#fbfaf7');
});
