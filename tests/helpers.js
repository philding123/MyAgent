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

/** Cross-platform zip writer for fixtures (deflate entries, forward-slash
 *  names) — replaces PowerShell Compress-Archive so zip tests run anywhere. */
function zipDirSync(srcDir, outZip, { prefix = '' } = {}) {
  const zlib = require('zlib');
  const files = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else files.push({ name: prefix + r, data: fs.readFileSync(path.join(dir, e.name)) });
    }
  })(srcDir, '');
  const locals = []; const centrals = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const crc = zlib.crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); centrals.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  fs.writeFileSync(outZip, Buffer.concat([...locals, cd, eocd]));
  return outZip;
}

module.exports = { makeTempHome, forkDaemon, sleep, ROOT, zipDirSync };
