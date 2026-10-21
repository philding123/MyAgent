'use strict';
// App icon for installers (electron-builder reads build/icon.png, ≥512px; it
// derives .ico/.icns from it). Rendered from inline SVG by an offscreen
// Electron window so the result is reproducible from source:
//   electron scripts/gen-app-icon.js   (Linux headless: xvfb-run -a …)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00c29a"/><stop offset="1" stop-color="#087866"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#g)"/>
  <path d="M272 724V316c0-14 17-21 27-11l213 213 213-213c10-10 27-3 27 11v408"
    fill="none" stroke="#fff" stroke-width="84" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M848 150l15 39 39 15-39 15-15 39-15-39-39-15 39-15z" fill="#fff" opacity=".92"/>
</svg>`;

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), img.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(out, 'icon-1024.png'), img.toPNG());
  console.log('wrote build/icon.png (512) + build/icon-1024.png');
  app.quit();
});
