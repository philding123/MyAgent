'use strict';
// Engine host (F05): one engine subprocess per active session, optional
// prewarm pool. Mirrors WorkBuddy cli-prewarm-pool semantics: prestarted
// idle processes, activation binds a sessionId, unexpected exits replenish.

const { fork } = require('child_process');
const path = require('path');
const { JsonlCodec } = require('./jsonl');

const ENGINE_PATH = path.join(__dirname, '..', 'engine', 'index.js');

class EngineHandle {
  constructor(child, sessionId, pool) {
    this.child = child;
    this.sessionId = sessionId;
    this.pool = pool;
    this.codec = new JsonlCodec();
    this.listeners = new Set();
    this.pipeFn = null;
    this.ready = false;
    this.readyWaiters = [];
    child.stdout.on('data', (d) => {
      for (const ev of this.codec.push(d)) {
        if (ev.type === 'status' && ev.stage === 'ready') {
          this.ready = true;
          const w = this.readyWaiters.splice(0);
          w.forEach((fn) => fn());
        }
        if (ev.type === 'daemon_tool_request' && pool.opts.daemonToolHandler) {
          // F25: engine-side tools backed by daemon capabilities (market).
          Promise.resolve()
            .then(() => pool.opts.daemonToolHandler(ev.tool, ev.args))
            .then((result) => this.send({ type: 'daemon_tool_result', id: ev.id, result }))
            .catch((e) => this.send({ type: 'daemon_tool_result', id: ev.id, result: { ok: false, summary: e.message } }));
          continue;
        }
        this.listeners.forEach((fn) => fn(ev));
      }
    });
    child.stderr.on('data', (d) => {
      this.listeners.forEach((fn) => fn({ type: 'engine_stderr', text: String(d).slice(0, 500) }));
    });
    child.on('exit', (code) => {
      this.alive = false;
      this.listeners.forEach((fn) => fn({ type: 'engine_exit', code }));
      this.pool.onEngineExit(this, code);
    });
    this.alive = true;
  }
  send(msg) { if (this.alive) this.child.stdin.write(JsonlCodec.encode(msg)); }
  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Exactly one fan-out pipe per handle: engine.start / scheduler / bridge
   * all re-pipe the same live handle, so a re-pipe must replace the previous
   * listener, never stack another (duplicate event delivery, T04c). */
  pipe(fn) {
    if (this.pipeFn) this.listeners.delete(this.pipeFn);
    this.pipeFn = fn;
    this.listeners.add(fn);
  }
  waitReady(timeoutMs) {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('engine init timeout')), timeoutMs || 15000);
      this.readyWaiters.push(() => { clearTimeout(t); resolve(); });
    });
  }
  kill() { this.alive = false; try { this.child.kill(); } catch (_) {} }
}

class EngineHost {
  /**
   * @param opts {emit: (topic,payload)=>void, buildInit: (sessionId)=>initMsg, prewarm: boolean}
   */
  constructor(opts) {
    this.opts = opts;
    this.engines = new Map(); // sessionId -> EngineHandle
    this.pool = [];           // idle prewarmed handles
    this.confirmWaiters = new Map(); // confirmId -> sessionId
  }

  spawnEngine(sessionId) {
    const child = fork(ENGINE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], silent: true });
    return new EngineHandle(child, sessionId, this);
  }

  onEngineExit(handle, code) {
    if (handle.sessionId === null) {
      // was a pooled idle engine -> replenish
      this.pool = this.pool.filter((h) => h !== handle);
      if (this.opts.prewarm && code !== 0) this.replenish();
      return;
    }
    const cur = this.engines.get(handle.sessionId);
    if (cur === handle) this.engines.delete(handle.sessionId);
    this.opts.emit('engine:' + handle.sessionId, { type: 'engine_exit', code });
  }

  replenish() {
    if (this.pool.length >= 1) return;
    const h = this.spawnEngine(null);
    this.pool.push(h);
    const init = this.opts.buildInit('__prewarm__');
    h.send({ type: 'init', ...init, sessionId: '__prewarm__' });
    this.opts.emit('pool', { type: 'replenished', size: this.pool.length });
  }

  async start(sessionId) {
    let handle = this.engines.get(sessionId);
    if (handle && handle.alive) return { reused: true };
    // take from pool if warm (F05 activation)
    const warm = this.pool.pop();
    if (warm && warm.alive) {
      warm.sessionId = sessionId;
      this.engines.set(sessionId, warm);
      if (this.opts.prewarm) this.replenish();
      this.opts.emit('engine:' + sessionId, { type: 'status', stage: 'activated-from-pool' });
      return { activated: true };
    }
    handle = this.spawnEngine(sessionId);
    this.engines.set(sessionId, handle);
    handle.send({ type: 'init', ...this.opts.buildInit(sessionId), sessionId });
    await handle.waitReady();
    return { spawned: true };
  }

  async userMessage(sessionId, text) {
    const h = this.engines.get(sessionId);
    if (!h || !h.alive) throw new Error('engine not running for session ' + sessionId);
    h.send({ type: 'user', text });
  }

  confirm(confirmId, approved) {
    const sessionId = this.confirmWaiters.get(confirmId);
    if (sessionId == null) return false;
    const h = this.engines.get(sessionId);
    if (h) h.send({ type: 'confirm', id: confirmId, approved });
    this.confirmWaiters.delete(confirmId);
    return true;
  }

  /** Stop and wait (bounded) for the process to actually exit, so a
   * following start() cannot race the late exit event. */
  stop(sessionId) {
    const h = this.engines.get(sessionId);
    if (!h) return Promise.resolve(false);
    this.engines.delete(sessionId);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(true), 1000);
      const off = h.onEvent((ev) => {
        if (ev.type === 'engine_exit') { clearTimeout(t); off(); resolve(true); }
      });
      h.kill();
    });
  }

  stopAll() {
    for (const h of this.engines.values()) h.kill();
    for (const h of this.pool) h.kill();
    this.engines.clear();
    this.pool = [];
  }

  stopPool() {
    for (const h of this.pool) h.kill();
    this.pool = [];
  }

  /** Wire engine events to the daemon emitter (replace-on-pipe); returns
   * unsubscribe for the current pipe. */
  pipeEvents(sessionId) {
    const h = this.engines.get(sessionId);
    if (!h) return () => {};
    h.pipe((ev) => {
      if (ev.type === 'confirm_request') this.confirmWaiters.set(ev.id, sessionId);
      this.opts.emit('engine:' + sessionId, ev);
    });
    return () => { if (h.pipeFn) { h.listeners.delete(h.pipeFn); h.pipeFn = null; } };
  }

  status() {
    return { active: this.engines.size, pool: this.pool.length, prewarm: !!this.opts.prewarm };
  }
}

class PrewarmPoolProbe {
  // testable variant of the pool logic without real processes
  constructor() { this.idle = 0; this.target = 1; this.events = []; this.onEmpty = null; }
  setPrewarm(on) { this.target = on ? 1 : 0; if (!on) this.idle = 0; else this.replenish(); this.events.push(['set', on]); }
  replenish() { while (this.idle < this.target) { this.idle++; this.events.push(['replenish']); } }
  activate() {
    if (this.idle > 0) { this.idle--; this.replenish(); return true; }
    return false;
  }
  onIdleExit() { this.idle = Math.max(0, this.idle - 1); this.events.push(['idle-exit']); if (this.target > 0) this.replenish(); }
}

module.exports = { EngineHost, EngineHandle, PrewarmPoolProbe, ENGINE_PATH };
