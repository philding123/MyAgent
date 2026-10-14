'use strict';
// Browser availability probe (F22), shared by daemon selfcheck and the engine
// tool. Pure detection: known install paths + optional env override. Never
// launches anything.

const fs = require('fs');

const CANDIDATES = {
  msedge: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  chrome: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe' : null,
  ],
};

function findBrowserExecutable() {
  const override = process.env.MYAGENT_BROWSER_PATH;
  if (override) {
    try { if (fs.statSync(override).isFile()) return { channel: null, executablePath: override }; } catch (_) {}
    return { channel: null, executablePath: null };
  }
  for (const [channel, paths] of Object.entries(CANDIDATES)) {
    for (const p of paths) {
      if (!p) continue;
      try { if (fs.statSync(p).isFile()) return { channel, executablePath: p }; } catch (_) {}
    }
  }
  return { channel: null, executablePath: null };
}

function playwrightLoadable() {
  try { require.resolve('playwright-core'); return true; } catch (_) { return false; }
}

function probeBrowser() {
  const found = findBrowserExecutable();
  return { available: !!(found.executablePath && playwrightLoadable()), channel: found.channel,
    executablePath: found.executablePath, playwright: playwrightLoadable() };
}

module.exports = { probeBrowser, findBrowserExecutable };
