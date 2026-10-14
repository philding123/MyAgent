'use strict';
// Tray + deeplink (F16).

const path = require('path');
const fs = require('fs');

function createTray(electron, { showMain, quit }) {
  const { Tray, Menu, nativeImage } = electron;
  let icon;
  const iconPath = path.join(__dirname, 'tray.png');
  if (fs.existsSync(iconPath)) icon = iconPath;
  else icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4EIwESMolGJMQIAbwQEAU9kJkIAAAAASUVORK5CYII=');
  const tray = new Tray(icon);
  tray.setToolTip('MyAgent');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show MyAgent', click: showMain },
    { type: 'separator' },
    { label: 'Quit', click: quit },
  ]));
  tray.on('click', showMain);
  return tray;
}

/** Parse myagent:// URLs -> [{action, params}] */
function parseDeeplink(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'myagent:') return null;
    // Windows sometimes double-slashes: myagent://session/abc
    const parts = (u.host || '') .split('/');
    const action = parts[0] || u.pathname.replace(/^\/+/, '').split('/')[0];
    const rest = (u.host ? u.pathname : u.pathname.replace(/^\/+/, '')).replace(/^\/+/, '');
    if (action === 'session') return { action: 'session', id: rest || u.searchParams.get('id') || '' };
    if (action === 'settings') return { action: 'settings' };
    return { action: action || 'show' };
  } catch (_) { return null; }
}

module.exports = { createTray, parseDeeplink };
