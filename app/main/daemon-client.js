'use strict';
// Daemon client (F02): forks the daemon over Node IPC, multiplexes requests,
// reconnects with backoff, forwards events.

const { fork } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const DAEMON_PATH = path.join(__dirname, '..', 'daemon', 'index.js');

class DaemonClient extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.seq = 0;
    this.pending = new Map();
    this.ready = false;
    this.snapshot = null;
    this.backoff = 500;
    this.restarts = 0;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this.child = fork(DAEMON_PATH, [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    this.child.on('message', (msg) => {
      if (!msg || !msg.kind) return;
      if (msg.kind === 'response') {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); p(msg); }
      } else if (msg.kind === 'event') {
        if (msg.topic === 'daemon:ready') {
          this.ready = true;
          this.snapshot = msg.payload;
          this.backoff = 500;
          this.emit('ready', msg.payload);
        }
        this.emit('event', msg);
      }
    });
    this.child.on('exit', (code) => {
      this.ready = false;
      const pending = [...this.pending.values()];
      this.pending.clear();
      pending.forEach((p) => p({ id: 0, ok: false, error: { code: 'daemon_exit', message: 'daemon exited code=' + code } }));
      this.emit('down', { code });
      if (!this.stopped && this.restarts < 5) {
        this.restarts++;
        setTimeout(() => this.start(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 8000);
      }
    });
  }

  request(method, params) {
    return new Promise((resolve) => {
      if (!this.child) return resolve({ ok: false, error: { code: 'daemon_down', message: 'daemon not running' } });
      const id = 'r' + (++this.seq);
      this.pending.set(id, resolve);
      this.child.send({ kind: 'request', id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ ok: false, error: { code: 'timeout', message: 'rpc timeout: ' + method } });
        }
      }, 30000);
    });
  }

  shutdown() {
    this.stopped = true;
    if (this.child) {
      try {
        if (process.platform === 'win32') {
          // kill the whole daemon+engine tree (orphan protection, F02)
          const { spawnSync } = require('child_process');
          spawnSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          this.child.kill();
        }
      } catch (_) {}
    }
  }
}

module.exports = { DaemonClient, DAEMON_PATH };
