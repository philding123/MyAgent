'use strict';
// Storage adapter (F03). Prefer better-sqlite3; fall back to JSON with the
// identical DAO surface so callers never branch on the backend.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, title TEXT, mode TEXT DEFAULT 'craft',
  created_at INTEGER, updated_at INTEGER, cwd TEXT);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
  tool_name TEXT, tool_json TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS memory(
  id TEXT PRIMARY KEY, kind TEXT, content TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS logs(ts INTEGER, level TEXT, scope TEXT, line TEXT);
`;

const id = () => crypto.randomUUID();

class JsonStore {
  constructor(file) {
    this.file = file;
    this.mode = 'json';
    this.db = { sessions: [], messages: [], settings: {}, memory: [], logs: [] };
    this.recovered = false;
    if (fs.existsSync(file)) {
      try {
        this.db = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        fs.renameSync(file, file + '.corrupt-' + Date.now());
        this.recovered = true;
      }
    }
    for (const k of ['sessions', 'messages', 'memory', 'logs'])
      if (!Array.isArray(this.db[k])) this.db[k] = [];
    if (typeof this.db.settings !== 'object' || this.db.settings === null) this.db.settings = {};
  }
  _flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }
  createSession(s) {
    const row = { id: s.id || id(), title: s.title || 'New session', mode: s.mode || 'craft',
      created_at: Date.now(), updated_at: Date.now(), cwd: s.cwd || os.homedir(),
      space: s.space || '', preset: s.preset || '' };
    this.db.sessions.unshift(row); this._flush(); return row;
  }
  listSessions() { return this.db.sessions.slice().sort((a, b) => b.updated_at - a.updated_at); }
  getSession(idv) { return this.db.sessions.find((s) => s.id === idv) || null; }
  updateSession(idv, patch) {
    const s = this.getSession(idv); if (!s) return null;
    Object.assign(s, patch, { updated_at: Date.now() }); this._flush(); return s;
  }
  deleteSession(idv) {
    this.db.sessions = this.db.sessions.filter((s) => s.id !== idv);
    this.db.messages = this.db.messages.filter((m) => m.session_id !== idv);
    this._flush(); return true;
  }
  appendMessage(m) {
    const row = { id: m.id || id(), session_id: m.session_id, role: m.role, content: m.content || '',
      tool_name: m.tool_name || null, tool_json: m.tool_json || null, created_at: m.created_at || Date.now() };
    this.db.messages.push(row);
    const s = this.getSession(m.session_id); if (s) s.updated_at = Date.now();
    this._flush(); return row;
  }
  /** F26 sync: replace-or-create a session row from a remote snapshot. */
  importSession(session, messages) {
    if (this.getSession(session.id)) this.deleteSession(session.id);
    const row = this.createSession({ id: session.id, title: session.title, mode: session.mode, cwd: session.cwd });
    this.updateSession(row.id, { created_at: session.created_at || row.created_at });
    if (session.updated_at) { row.updated_at = session.updated_at; this._flush(); }
    for (const m of messages || []) {
      this.appendMessage({ id: m.id, session_id: session.id, role: m.role, content: m.content,
        tool_name: m.tool_name, tool_json: m.tool_json, created_at: m.created_at });
    }
    return row;
  }
  listMessages(sessionId) {
    return this.db.messages.filter((m) => m.session_id === sessionId).sort((a, b) => a.created_at - b.created_at);
  }
  searchMessages(q) {
    const needle = String(q).toLowerCase();
    return this.db.messages.filter((m) => (m.content || '').toLowerCase().includes(needle));
  }
  getSetting(k) { const v = this.db.settings[k]; return v === undefined ? null : JSON.parse(v); }
  setSetting(k, v) { this.db.settings[k] = JSON.stringify(v); this._flush(); }
  allSettings() { const o = {}; for (const [k, v] of Object.entries(this.db.settings)) o[k] = JSON.parse(v); return o; }
  addMemory(kind, content) {
    const row = { id: id(), kind, content, created_at: Date.now() };
    this.db.memory.push(row); this._flush(); return row;
  }
  listMemory(kind) {
    return this.db.memory.filter((m) => !kind || m.kind === kind);
  }
  deleteMemory(idv) { this.db.memory = this.db.memory.filter((m) => m.id !== idv); this._flush(); return true; }
  log(level, scope, line) {
    this.db.logs.push({ ts: Date.now(), level, scope, line });
    if (this.db.logs.length > 5000) this.db.logs = this.db.logs.slice(-4000);
    this._flush();
  }
  health() { return { mode: this.mode, ok: true, recovered: this.recovered }; }
  checkpoint() { return { ok: true }; }
  close() { this._flush(); }
}

class SqliteStore {
  constructor(Database, file) {
    this.mode = 'sqlite';
    this.recovered = false;
    try {
      this.db = new Database(file);
      this.db.pragma('journal_mode = WAL');
    } catch (e) {
      // corrupt db: close the handle (Windows locks open files), clear sidecars,
      // move the bad file aside, then rebuild.
      try { this.db && this.db.close(); } catch (_) {}
      this.db = null;
      for (const side of ['', '-wal', '-shm']) {
        const f = file + side;
        if (!fs.existsSync(f)) continue;
        try { fs.renameSync(f, f + '.corrupt-' + Date.now()); }
        catch (_) { try { fs.unlinkSync(f); } catch (_) {} }
      }
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.recovered = true;
  }
  this.db.exec(SCHEMA);
  // F39/F41: space + preset columns for stores created before Phase 8
  for (const col of ['space', 'preset']) {
    const cols = this.db.pragma('table_info(sessions)').map((c) => c.name);
    if (!cols.includes(col)) this.db.exec('ALTER TABLE sessions ADD COLUMN ' + col + " TEXT DEFAULT ''");
  }
}
  createSession(s) {
    const row = { id: s.id || id(), title: s.title || 'New session', mode: s.mode || 'craft',
      created_at: Date.now(), updated_at: Date.now(), cwd: s.cwd || os.homedir(),
      space: s.space || '', preset: s.preset || '' };
    this.db.prepare('INSERT INTO sessions(id,title,mode,created_at,updated_at,cwd,space,preset) VALUES (?,?,?,?,?,?,?,?)')
      .run(row.id, row.title, row.mode, row.created_at, row.updated_at, row.cwd, row.space, row.preset);
    return row;
  }
  listSessions() { return this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all(); }
  getSession(idv) { return this.db.prepare('SELECT * FROM sessions WHERE id=?').get(idv) || null; }
  updateSession(idv, patch) {
    const s = this.getSession(idv); if (!s) return null;
    Object.assign(s, patch, { updated_at: Date.now() });
    this.db.prepare('UPDATE sessions SET title=?,mode=?,updated_at=?,cwd=?,created_at=?,space=?,preset=? WHERE id=?')
      .run(s.title, s.mode, s.updated_at, s.cwd, s.created_at, s.space || '', s.preset || '', idv);
    return s;
  }
  deleteSession(idv) {
    this.db.prepare('DELETE FROM sessions WHERE id=?').run(idv);
    this.db.prepare('DELETE FROM messages WHERE session_id=?').run(idv);
    return true;
  }
  appendMessage(m) {
    const row = { id: m.id || id(), session_id: m.session_id, role: m.role, content: m.content || '',
      tool_name: m.tool_name || null, tool_json: m.tool_json || null, created_at: m.created_at || Date.now() };
    this.db.prepare('INSERT INTO messages(id,session_id,role,content,tool_name,tool_json,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(row.id, row.session_id, row.role, row.content, row.tool_name, row.tool_json, row.created_at);
    this.db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(Date.now(), m.session_id);
    return row;
  }
  /** F26 sync: replace-or-create a session row from a remote snapshot. */
  importSession(session, messages) {
    if (this.getSession(session.id)) this.deleteSession(session.id);
    const row = this.createSession({ id: session.id, title: session.title, mode: session.mode, cwd: session.cwd });
    this.updateSession(row.id, { created_at: session.created_at || row.created_at });
    for (const m of messages || []) {
      this.appendMessage({ id: m.id, session_id: session.id, role: m.role, content: m.content,
        tool_name: m.tool_name, tool_json: m.tool_json, created_at: m.created_at });
    }
    if (session.updated_at) {
      this.db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(session.updated_at, session.id);
    }
    return row;
  }
  listMessages(sessionId) {
    return this.db.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY created_at').all(sessionId);
  }
  searchMessages(q) {
    return this.db.prepare("SELECT * FROM messages WHERE lower(content) LIKE ? ORDER BY created_at DESC LIMIT 100")
      .all('%' + String(q).toLowerCase() + '%');
  }
  getSetting(k) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(k);
    return row ? JSON.parse(row.value) : null;
  }
  setSetting(k, v) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(k, JSON.stringify(v));
  }
  allSettings() {
    const o = {};
    for (const r of this.db.prepare('SELECT key,value FROM settings').all()) o[r.key] = JSON.parse(r.value);
    return o;
  }
  addMemory(kind, content) {
    const row = { id: id(), kind, content, created_at: Date.now() };
    this.db.prepare('INSERT INTO memory(id,kind,content,created_at) VALUES (?,?,?,?)')
      .run(row.id, kind, content, row.created_at);
    return row;
  }
  listMemory(kind) {
    return kind
      ? this.db.prepare('SELECT * FROM memory WHERE kind=? ORDER BY created_at').all(kind)
      : this.db.prepare('SELECT * FROM memory ORDER BY created_at').all();
  }
  deleteMemory(idv) { this.db.prepare('DELETE FROM memory WHERE id=?').run(idv); return true; }
  log(level, scope, line) {
    this.db.prepare('INSERT INTO logs(ts,level,scope,line) VALUES (?,?,?,?)').run(Date.now(), level, scope, line);
  }
  health() { return { mode: this.mode, ok: true, recovered: this.recovered }; }
  checkpoint() { this.db.pragma('wal_checkpoint(TRUNCATE)'); return { ok: true }; }
  close() { this.db.close(); }
}

/** One-time JSON→SQLite migration (personal data continuity): imports a
 * store.json snapshot into an EMPTY sqlite store. Returns a summary line. */
function migrateJsonSnapshot(store, snapshot) {
  let counts = { sessions: 0, messages: 0, settings: 0, memory: 0 };
  for (const s of snapshot.sessions || []) {
    store.createSession({ id: s.id, title: s.title, mode: s.mode, cwd: s.cwd });
    store.updateSession(s.id, { created_at: s.created_at });
    counts.sessions++;
  }
  for (const m of snapshot.messages || []) {
    store.appendMessage({ id: m.id, session_id: m.session_id, role: m.role, content: m.content,
      tool_name: m.tool_name, tool_json: m.tool_json, created_at: m.created_at });
    counts.messages++;
  }
  for (const [k, v] of Object.entries(snapshot.settings || {})) {
    if (k.includes('apiKey')) continue; // secrets only ever live in the vault
    store.setSetting(k, v);
    counts.settings++;
  }
  for (const mem of snapshot.memory || []) store.addMemory(mem.kind, mem.content);
  counts.memory = (snapshot.memory || []).length;
  return counts;
}

/** Opens the best available store. @returns {{store, warning?}} */
function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'myagent.db');
  let warning;
  const candidates = [];
  if (process.versions.electron) {
    // Electron's node ABI ≠ system node ABI: prefer the vendored Electron-ABI
    // copy (scripts/setup-electron-sqlite.mjs) so the shell gets real SQLite.
    candidates.push(path.join(__dirname, '..', '..', 'vendor', 'better-sqlite3-electron'));
  }
  candidates.push('better-sqlite3');
  for (const mod of candidates) {
    try {
      // eslint-disable-next-line global-require
      const Database = require(mod);
      const store = new SqliteStore(Database, file);
      // continuity: first run after switching to sqlite absorbs the JSON store
      const jsonFile = path.join(dataDir, 'store.json');
      if (fs.existsSync(jsonFile) && store.listSessions().length === 0) {
        try {
          const snapshot = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
          if (Array.isArray(snapshot.sessions) && snapshot.sessions.length) {
            const counts = migrateJsonSnapshot(store, snapshot);
            fs.renameSync(jsonFile, jsonFile + '.pre-sqlite');
            warning = 'migrated from JSON store: ' + JSON.stringify(counts);
          }
        } catch (e) {
          warning = 'json→sqlite migration skipped (' + String(e.message).split('\n')[0] + ')';
        }
      }
      return { store, warning };
    } catch (e) {
      warning = 'sqlite via ' + mod + ' unavailable (' + String(e.message).split('\n')[0] + ')';
    }
  }
  warning = (warning ? warning + '; ' : '') + 'using JSON store';
  return { store: new JsonStore(path.join(dataDir, 'store.json')), warning };
}

module.exports = { openStore, JsonStore, SqliteStore, id, migrateJsonSnapshot };
