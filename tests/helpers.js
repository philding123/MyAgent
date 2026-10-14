'use strict';
// Shared test helpers: temp MYAGENT_HOME + daemon fork protocol client.

const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function makeTempHome(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-' + tag + '-'));
  return dir;
}

/** Fork the real daemon and speak its request/response protocol. */
function forkDaemon(home, extraEnv) {
  const child = fork(path.join(ROOT, 'app', 'daemon', 'index.js'), [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, MYAGENT_HOME: home, ...(extraEnv || {}) },
  });
  const events = [];
  const waiters = [];
  let seq = 0;
  const pending = new Map();
  child.on('message', (msg) => {
    if (!msg || !msg.kind) return;
    if (msg.kind === 'response') {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg); }
    } else if (msg.kind === 'event') {
      events.push(msg);
      const idx = events.length - 1;
      for (const w of [...waiters]) {
        if (w.match(msg, idx)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
      }
    }
  });
  const request = (method, params) => new Promise((resolve) => {
    const id = 'r' + (++seq);
    pending.set(id, resolve);
    child.send({ kind: 'request', id, method, params });
  });
  const waitEvent = (match, timeoutMs) => new Promise((resolve, reject) => {
    const found = events.find((e, i) => match(e, i));
    if (found) return resolve(found);
    const w = { match, resolve };
    waiters.push(w);
    const t = setTimeout(() => reject(new Error('event timeout')), timeoutMs || 15000);
    const origResolve = w.resolve;
    w.resolve = (v) => { clearTimeout(t); origResolve(v); };
  });
  return { child, request, events, waitEvent };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { makeTempHome, forkDaemon, sleep, ROOT };
