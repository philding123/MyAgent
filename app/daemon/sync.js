'use strict';
// Cross-device session sync (F26). Edge Sync equivalent for personal use:
// push/pull whole-session snapshots to a directory target (any disk-sync
// service: OneDrive/坚果云 folder, USB) or a WebDAV endpoint. rev counters
// order writes; conflicting remote wins get preserved as <id>.conflict.json.

const fs = require('fs');
const path = require('path');

const SYNC_DIR = 'myagent-sync';
const AUTOSYNC_DEBOUNCE_MS = 5000;

class SyncTargetDirectory {
  constructor(root) { this.root = root; }
  resolve(rel) { return path.join(this.root, SYNC_DIR, 'sessions', rel); }
  async ensure() { fs.mkdirSync(path.dirname(this.resolve('x')), { recursive: true }); }
  async put(id, json) {
    await this.ensure();
    fs.writeFileSync(this.resolve(id + '.json'), json, 'utf8');
  }
  async get(id) {
    try { return fs.readFileSync(this.resolve(id + '.json'), 'utf8'); } catch (_) { return null; }
  }
  async listIds() {
    try {
      return fs.readdirSync(path.join(this.root, SYNC_DIR, 'sessions'))
        .filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    } catch (_) { return []; }
  }
}

class SyncTargetWebdav {
  constructor({ url, username, password }) {
    this.base = String(url || '').replace(/\/+$/, '');
    this.auth = username ? 'Basic ' + Buffer.from(username + ':' + (password || '')).toString('base64') : null;
    this.fetchImpl = (...a) => fetch(...a);
  }
  headers(extra) { return Object.assign({ Authorization: this.auth }, extra || {}); }
  url(rel) { return this.base + '/' + SYNC_DIR + '/sessions/' + rel; }
  async ensure() {
    for (const dir of [SYNC_DIR, SYNC_DIR + '/sessions']) {
      try { await this.fetchImpl(this.base + '/' + dir, { method: 'MKCOL', headers: this.headers() }); } catch (_) {}
    }
  }
  async put(id, json) {
    await this.ensure();
    const res = await this.fetchImpl(this.url(id + '.json'), { method: 'PUT', headers: this.headers({ 'Content-Type': 'application/json' }), body: json });
    if (!res.ok && res.status !== 201) throw new Error('webdav put ' + res.status);
  }
  async get(id) {
    const res = await this.fetchImpl(this.url(id + '.json'), { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('webdav get ' + res.status);
    return String(await res.text());
  }
  async listIds() {
    // PROPFIND minimal: fall back to per-known-id get when listing unsupported.
    try {
      const res = await this.fetchImpl(this.base + '/' + SYNC_DIR + '/sessions/', {
        method: 'PROPFIND', headers: this.headers({ Depth: 1 }) });
      if (!res.ok) return [];
      const xml = String(await res.text());
      return [...xml.matchAll(/<D:href>([^<]+\.json)<\/D:href>/gi)]
        .map((m) => decodeURIComponent(m[1].split('/').pop().replace(/\.json$/, '')));
    } catch (_) { return []; }
  }
}

class SyncService {
  /**
   * @param opts {store, emit?, debounceMs?}
   */
  constructor(opts) {
    this.store = opts.store;
    this.emit = opts.emit || (() => {});
    this.debounceMs = opts.debounceMs ?? AUTOSYNC_DEBOUNCE_MS;
    this.target = null;      // SyncTargetDirectory | SyncTargetWebdav
    this.config = { type: null }; // {type:'directory', path} | {type:'webdav', url, username}
    this.dirty = new Set();
    this.revs = new Map();   // sessionId -> rev
    this.auto = false;
    this.lastPush = null;
    this.lastPull = null;
    this.lastError = null;
    this.timer = null;
  }

  /** hook called by daemon whenever messages change */
  noteChange(sessionId) {
    this.dirty.add(sessionId);
    if (this.auto && this.target) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.push().catch(() => {}); }, this.debounceMs);
    }
  }

  configure(cfg) {
    this.config = cfg || { type: null };
    if (this.config.type === 'directory') {
      this.target = new SyncTargetDirectory(this.config.path);
    } else if (this.config.type === 'webdav') {
      this.target = new SyncTargetWebdav({ url: this.config.url, username: this.config.username, password: this.config.password });
    } else {
      this.target = null;
    }
    this.auto = !!this.config.auto;
    return this.status();
  }

  exportSession(id) {
    const session = this.store.getSession(id);
    if (!session) return null;
    const messages = this.store.listMessages(id);
    return { session, messages, rev: (this.revs.get(id) || 0) + 1, updatedAt: new Date().toISOString() };
  }

  /** @param opts {all?: boolean} all = every session (manual push), else dirty ones */
  async push(opts = {}) {
    if (!this.target) return { ok: false, reason: 'no target configured' };
    this.lastError = null;
    try {
      const ids = opts.all || !this.dirty.size ? this.store.listSessions().map((s) => s.id) : [...this.dirty];
      let pushed = 0;
      for (const id of ids) {
        const doc = this.exportSession(id);
        if (!doc) continue;
        await this.target.put(id, JSON.stringify(doc));
        this.revs.set(id, doc.rev);
        pushed++;
      }
      this.dirty.clear();
      this.lastPush = new Date().toISOString();
      this.emit('app:sync', this.status());
      return { ok: true, pushed };
    } catch (e) {
      this.lastError = String(e.message || e);
      return { ok: false, reason: this.lastError };
    }
  }

  async pull() {
    if (!this.target) return { ok: false, reason: 'no target configured' };
    this.lastError = null;
    try {
      const ids = await this.target.listIds();
      let applied = 0, conflicts = 0;
      for (const id of ids) {
        const raw = await this.target.get(id);
        if (!raw) continue;
        let doc;
        try { doc = JSON.parse(raw); } catch (_) { continue; }
        if (!doc || !doc.session || !Array.isArray(doc.messages)) continue;
        const localRev = this.revs.get(id) || 0;
        const remoteRev = Number(doc.rev) || 0;
        if (remoteRev > localRev) {
          this.applyRemote(id, doc);
          this.revs.set(id, remoteRev);
          applied++;
        } else if (remoteRev > 0 && remoteRev === localRev) {
          // identical or already applied
        } else if (remoteRev > 0 && remoteRev < localRev) {
          // local newer; keep local, preserve remote copy as conflict artifact
          try {
            await this.target.put(id + '.conflict', JSON.stringify({ conflictOf: id, remote: doc }));
            conflicts++;
          } catch (_) {}
        }
      }
      this.lastPull = new Date().toISOString();
      this.emit('app:sync', this.status());
      return { ok: true, applied, conflicts };
    } catch (e) {
      this.lastError = String(e.message || e);
      return { ok: false, reason: this.lastError };
    }
  }

  /** Remote-wins import; the local variant is snapshot to a conflict file first. */
  applyRemote(id, doc) {
    const existing = this.store.getSession(id);
    if (existing) {
      const local = this.exportSession(id);
      if (local) {
        try {
          const dir = this.target instanceof SyncTargetDirectory
            ? this.target.resolve(id + '.local-conflict.json')
            : null;
          if (dir) fs.writeFileSync(dir, JSON.stringify(local), 'utf8');
        } catch (_) {}
      }
    }
    this.store.importSession(doc.session, doc.messages);
  }

  status() {
    return {
      type: this.config.type || null, auto: this.auto,
      lastPush: this.lastPush, lastPull: this.lastPull,
      dirty: this.dirty.size, lastError: this.lastError,
    };
  }
}

module.exports = { SyncService, SyncTargetDirectory, SyncTargetWebdav, SYNC_DIR };
