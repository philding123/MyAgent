#!/usr/bin/env node
// REA connector validation (F52 real-world check): wire the machine's real
// REA MCP server (wsl.exe -d Ubuntu-24.04 -e bash -lc "rea mcp") into MyAgent
// as a connector via the product RPC, then list its tools and call one
// read-only tool. Spawns the real app with CDP; leaves the connector
// installed (persistent setting) — rerun safe.
//
//   node scripts/rea-connector-check.mjs

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function treeKill(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  } catch {}
}

const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
const child = spawn(process.execPath, [electronJs, '.', '--remote-debugging-port=9222',
  '--force-device-scale-factor=1'], { cwd: ROOT, stdio: 'ignore' });
let browser = null;
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { await sleep(1000); try { await fetch('http://127.0.0.1:9222/json/version'); up = true; } catch {} }
  if (!up) throw new Error('CDP never came up');
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 20000 });
  const main = browser.contexts()[0].pages().find((p) => /index\.html/.test(p.url()));
  await main.waitForLoadState('load');
  await sleep(1500);

  const rpc = (method, params) => main.evaluate(async ([m, p]) => {
    const r = await window.myagent.invoke(m, p);
    if (!r.ok) throw new Error((r.error && r.error.message) || 'rpc error');
    return r.result;
  }, [method, params === undefined ? {} : params]);

  const existing = await rpc('connectors.list');
  if (!existing.some((c) => c.name === 'rea')) {
    await rpc('connectors.add', {
      name: 'rea',
      command: 'wsl.exe',
      args: ['-d', 'Ubuntu-24.04', '-e', 'bash', '-lc', 'rea mcp'],
    });
    console.log('[rea] connector added');
  }
  let cat = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    cat = await rpc('connectors.list');
    const rea = cat.find((c) => c.name === 'rea');
    if (rea && rea.state === 'connected') break;
    if (rea && rea.state === 'error' && i > 5) break;
  }
  const rea = cat.find((c) => c.name === 'rea');
  console.log('[rea] state:', rea.state, rea.error || '');
  console.log('[rea] tools:', rea.tools.map((t) => 'mcp_rea_' + t.name).join(', '));
  if (rea.state !== 'connected') throw new Error('REA connector not connected: ' + (rea.error || rea.state));

  // call one read-only tool for a live round-trip
  const candidate = rea.tools.find((t) => /saved_workflows|workflow/i.test(t.name))
    || rea.tools.find((t) => /list|status|bundle/i.test(t.name));
  if (candidate) {
    const out = await rpc('connectors.call', { server: 'rea', name: candidate.name, arguments: {} });
    console.log('[rea] live call', candidate.name, '→', String(out.content).slice(0, 300).replace(/\s+/g, ' '));
  } else {
    console.log('[rea] no obviously read-only tool to call; connection + tool list is the evidence');
  }
  console.log('REA CONNECTOR CHECK: PASS');
} catch (e) {
  console.log('REA CONNECTOR CHECK: FAIL —', String(e.message || e).slice(0, 300));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await sleep(500);
  treeKill(child);
}
