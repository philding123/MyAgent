'use strict';
// Offscreen screenshot tool for the WorkBuddy pixel baseline (design/27):
// loads a file URL in an offscreen Electron window at a fixed content size
// and captures the page. javascript=false reproduces the CSS-spec skeleton
// (no bootstrap DOM, no React); javascript=true lets the classic
// skeleton-bootstrap.js build the settings/search first-paint DOM while the
// React module graph stays unloaded over file:// CORS.
// Usage: electron scripts/electron-shot.js --url <file://...> --w 1280 --h 800 --out x.png [--js]
// PIXEL_SHOT_DARK=1 forces prefers-color-scheme: dark (wb skeleton dark variants).
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
try { fs.appendFileSync('electron-shot-boot.log', 'boot pid=' + process.pid + ' argv=' + JSON.stringify(process.argv) + '\n'); } catch {}

const arg = (n, d) => {
  // args must survive several shells on this box; env vars are the reliable
  // channel, argv kept as fallback for direct manual runs
  const e = process.env['PIXEL_SHOT_' + n.toUpperCase().replace(/-([a-z])/g, (m, c) => c.toUpperCase())];
  if (e !== undefined) return e;
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const url = arg('url');
const W = +arg('w', 1280);
const H = +arg('h', 800);
const out = arg('out');
const enableJs = (process.env.PIXEL_SHOT_JS || '') !== '' || process.argv.includes('--js');
// same proven combo as the app itself on this machine (GPU sandbox crash-loop)
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
// evidence needs 1 CSS px == 1 PNG px regardless of the display scale factor
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  // --force-dark-mode does not move prefers-color-scheme in Electron; the
  // supported channel is nativeTheme.themeSource
  if ((process.env.PIXEL_SHOT_DARK || '') !== '') nativeTheme.themeSource = 'dark';
});

const log = (m) => fs.appendFileSync(out + '.log', m + '\n');
process.on('uncaughtException', (e) => { try { log('UNCAUGHT: ' + (e && e.stack || e)); } catch {} app.quit(); });
process.on('unhandledRejection', (e) => { try { log('UNHANDLED: ' + (e && e.stack || e)); } catch {} app.quit(); });

const http = require('http');
const pathMod = require('path');

// PIXEL_SHOT_HTTP=1 + PIXEL_SHOT_DOCROOT: serve the docroot over
// 127.0.0.1:<ephemeral> and rewrite the file:// URL to http:// so the wb
// renderer's ES-module graph loads (file:// blocks module CORS).
function startServer(docroot) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };
  return new Promise((resolve) => {
    const rootLower = docroot.toLowerCase();
    const srv = http.createServer((req, res) => {
      // the file:// URL carries an absolute path (/C:/...); keep requests
      // inside the docroot and resolve the drive path directly
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/([A-Za-z]:)/, '$1');
      p = pathMod.normalize(p);
      if (!p.toLowerCase().startsWith(rootLower)) { res.writeHead(403); res.end(); return; }
      fs.readFile(p, (e, buf) => {
        if (e) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types[pathMod.extname(p)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

app.whenReady().then(async () => {
  try {
    log('ready');
    let target = url;
    let srv = null;
    if ((process.env.PIXEL_SHOT_HTTP || '') !== '') {
      srv = await startServer(process.env.PIXEL_SHOT_DOCROOT);
      const port = srv.address().port;
      target = url.replace(/^file:\/\/\//, `http://127.0.0.1:${port}/`);
      log('http rewrite -> ' + target);
    }
    const useStub = (process.env.PIXEL_SHOT_STUB || '') !== '';
    const win = new BrowserWindow({
      width: W, height: H, useContentSize: true, show: false, frame: false,
      webPreferences: {
        javascript: enableJs || useStub,
        offscreen: false,
        backgroundThrottling: false,
        paintWhenInitiallyHidden: true,
        ...(useStub ? {
          preload: pathMod.join(__dirname, 'wb-stub-preload.js'),
          contextIsolation: false,
          sandbox: false,
          nodeIntegration: false,
        } : {}),
      },
    });
    win.webContents.on('console-message', (e, level, message, line, sourceId) => {
      log('console[' + level + '] ' + String(message).slice(0, 300) + ' @' + String(sourceId).split('/').pop() + ':' + line);
    });
    await win.loadURL(target);
    // freeze animations and drop the loading shimmer overlay (not layout —
    // keeping it would bake a random animation frame into the baseline)
    await win.webContents.insertCSS(
      '*, *::before, *::after { animation: none !important; transition: none !important; }' +
      '.sk-shimmer { display: none !important; }');
    await new Promise((r) => setTimeout(r, useStub ? 5000 : 1200)); // real React mount vs skeleton settle
    let image = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
    if (useStub) {
      const dom = await win.webContents.executeJavaScript(
        '({root: document.getElementById("root").childElementCount, skel: !!document.getElementById("skeleton-root"), text: document.body.innerText.slice(0, 120), links: document.querySelectorAll("link[rel=stylesheet]").length})', true).catch((e) => 'eval-fail ' + e.message);
      log('dom ' + JSON.stringify(dom));
    }
    if (image.isEmpty()) {
      // hidden-window capture can come back empty on some GPU configs; flash
      // the window briefly (display is asleep, user-away) and retry
      log('empty capture, retrying visible');
      win.show();
      await new Promise((r) => setTimeout(r, 700));
      image = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
    }
    fs.writeFileSync(out, image.toPNG());
    log('saved ' + out + ` ${W}x${H} js=${enableJs} empty=${image.isEmpty()}`);
  } catch (e) {
    log('ERROR: ' + (e && e.stack || e));
  }
  app.quit();
});
