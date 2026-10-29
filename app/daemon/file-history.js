'use strict';
// F58 file history (design/42): local version snapshots of files MyAgent
// itself wrote or delivered. WorkBuddy keeps versions server-side
// (FileHistoryService); the personal replica snapshots bytes locally.
// Snapshots are best-effort — a snapshot failure must never block or fail
// the underlying write, so record() returns a reason instead of throwing
// (restore/delete are user actions and DO fail with typed errors).
//
// Layout: <dir>/<sha256(path)[0:32]>/index.json + <seq>.bin — per-path index
// (implementation ruling recorded in design/42: one JSON index per path at
// personal scale; no sqlite ABI dance, deleting a directory deletes a file's
// whole history).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = { count: 10, expireDays: 30, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 };
const clamp = (n, lo, hi, dflt) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt);

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

function assertLocalPath(p) {
  if (typeof p !== 'string' || !p.trim() || /[\x00-\x1f]/.test(p) || /[\\/]$/.test(p)
    || !path.isAbsolute(p) || /^[\\/]{2}/.test(p) || /:/.test(p.replace(/^[A-Za-z]:/, ''))) {
    fail('unsafe_path', 'not a local absolute file path');
  }
  return path.resolve(p);
}

const pathDir = (root, p) => path.join(root, crypto.createHash('sha256').update(p).digest('hex').slice(0, 32));

function readIndex(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); }
  catch (_) { return { path: '', versions: [], nextSeq: 1 }; }
}

function writeIndex(dir, index) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'index.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, path.join(dir, 'index.json'));
}

function binFor(dir, entry) { return path.join(dir, entry.id + '.bin'); }

// ---- minimal line diff: prefix/suffix trim, LCS over the changed middle
// (full-table backtrack; the 250k-cell cap bounds memory), rendered with ±2
// context rows. Beyond the caps the caller gets counts, never a silently
// truncated diff.
function diffLines(oldText, newText) {
  const a = String(oldText).split(/\r?\n/);
  const b = String(newText).split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const removed = midA.length;
  const added = midB.length;
  if (!removed && !added) return { lines: [], added: 0, removed: 0 };
  if (removed * added > 250000) return { lines: null, added, removed };
  const w = added + 1;
  const rows = [new Int32Array(w)];
  for (let i = 1; i <= removed; i++) {
    const prev = rows[i - 1];
    const cur = new Int32Array(w);
    for (let j = 1; j <= added; j++) {
      cur[j] = midA[i - 1] === midB[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    rows.push(cur);
  }
  const ops = [];
  let i = removed, j = added;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && midA[i - 1] === midB[j - 1]) { ops.push(['ctx', midA[i - 1]]); i--; j--; }
    else if (j > 0 && (i === 0 || rows[i][j - 1] >= rows[i - 1][j])) { ops.push(['add', midB[j - 1]]); j--; }
    else { ops.push(['del', midA[i - 1]]); i--; }
  }
  ops.reverse();
  // honest counts of actual ops (the tooLarge branch above reports the
  // untrimmed middle sizes instead — that approximation is documented there)
  const nAdd = ops.filter((op) => op[0] === 'add').length;
  const nDel = ops.filter((op) => op[0] === 'del').length;
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, k) => { if (op[0] !== 'ctx') for (let d = -2; d <= 2; d++) { if (k + d >= 0 && k + d < ops.length) keep[k + d] = true; } });
  const lines = [];
  let budget = 600;
  for (let k = 0; k < ops.length; k++) {
    if (keep[k]) {
      if (budget-- <= 0) { lines.push({ type: 'truncated' }); break; }
      lines.push({ type: ops[k][0], text: ops[k][1] });
    } else if (lines.length && k + 1 < ops.length) {
      let run = 0; while (k < ops.length && !keep[k]) { run++; k++; }
      k--; lines.push({ type: 'gap', count: run });
    }
  }
  return { lines, added: nAdd, removed: nDel };
}

function createFileHistory({ dir, getSetting, log = () => {}, now = () => Date.now() }) {
  const cfg = (key) => {
    const v = getSetting ? getSetting('fileHistory.' + key) : null;
    if (key === 'count') return clamp(v, 1, 100, DEFAULTS.count);
    if (key === 'expireDays') return clamp(v, 1, 3650, DEFAULTS.expireDays);
    if (key === 'maxFileBytes') return clamp(v, 1, 100 * 1024 * 1024, DEFAULTS.maxFileBytes);
    if (key === 'maxTotalBytes') return clamp(v, 1, 1024 * 1024 * 1024, DEFAULTS.maxTotalBytes);
    return v;
  };
  const enabled = () => (getSetting ? getSetting('fileHistory.enable') : null) !== false;
  let pruneTimer = null;
  function pruneSoon() {
    if (pruneTimer) return;
    pruneTimer = setTimeout(() => { pruneTimer = null; try { pruneAll(); } catch (e) { log('warn', 'file-history', 'prune failed: ' + e.message); } }, 2000);
    if (typeof pruneTimer.unref === 'function') pruneTimer.unref();
  }

  function dropEntry(dir, index, entry) {
    if (!entry.skipped) { try { fs.unlinkSync(binFor(dir, entry)); } catch (_) {} }
    index.versions = index.versions.filter((v) => v !== entry);
  }

  function prunePath(dir, index, at) {
    const expireMs = cfg('expireDays') * 86400000;
    for (const v of [...index.versions]) if (at - v.createdAt >= expireMs) dropEntry(dir, index, v);
    const keep = cfg('count');
    while (index.versions.length > keep) dropEntry(dir, index, index.versions[0]);
  }

  function pruneAll() {
    const cap = cfg('maxTotalBytes');
    let entries = [];
    let dirs;
    try { dirs = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return { paths: 0, evicted: 0 }; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const pdir = path.join(dir, d.name);
      const index = readIndex(pdir);
      prunePath(pdir, index, now());
      if (!index.versions.length) { try { fs.rmSync(pdir, { recursive: true, force: true }); } catch (_) {} continue; }
      writeIndex(pdir, index);
      for (const v of index.versions) if (!v.skipped) entries.push({ pdir, index, v });
    }
    entries.sort((x, y) => x.v.createdAt - y.v.createdAt);
    let total = entries.reduce((sum, e) => sum + (e.v.size || 0), 0);
    let evicted = 0;
    const touched = new Map(); // pdir -> the in-memory (already pruned) index
    for (const e of entries) {
      touched.set(e.pdir, e.index);
      if (total <= cap) continue;
      dropEntry(e.pdir, e.index, e.v);
      total -= e.v.size || 0;
      evicted++;
    }
    // persist exactly the mutated in-memory indexes — re-reading from disk
    // here would clobber the eviction (the on-disk copy still has it)
    for (const [pdir, index] of touched) {
      if (index.versions.length) writeIndex(pdir, index);
      else { try { fs.rmSync(pdir, { recursive: true, force: true }); } catch (_) {} }
    }
    return { paths: dirs.length, evicted };
  }

  /** Best-effort snapshot of the CURRENT on-disk content. Never throws. */
  function record(target, { sessionId = '', tool = 'write_file' } = {}) {
    let p;
    try { p = assertLocalPath(target); }
    catch (e) { log('warn', 'file-history', 'record rejected path: ' + e.message); return { ok: false, reason: 'unsafe_path' }; }
    if (!enabled()) return { ok: false, reason: 'disabled' };
    const at = now();
    const pdir = pathDir(dir, p);
    const index = readIndex(pdir);
    index.path = p;
    let stat;
    try { stat = fs.statSync(p); } catch (_) { return { ok: false, reason: 'missing' }; }
    if (!stat.isFile()) return { ok: false, reason: 'not_file' };
    const id = String(index.nextSeq || 1);
    index.nextSeq = Number(id) + 1;
    let entry;
    if (stat.size > cfg('maxFileBytes')) {
      entry = { id, createdAt: at, size: stat.size, sha256: null, tool, sessionId, skipped: 'too_large' };
    } else {
      try {
        const bytes = fs.readFileSync(p);
        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        const tmp = path.join(pdir, id + '.bin.tmp');
        fs.mkdirSync(pdir, { recursive: true });
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, binFor(pdir, { id }));
        entry = { id, createdAt: at, size: stat.size, mtime: stat.mtimeMs, sha256: sha, tool, sessionId };
      } catch (e) {
        index.nextSeq = Number(id); // seq unused, reuse on next attempt
        log('warn', 'file-history', 'snapshot failed (kept write): ' + e.message);
        return { ok: false, reason: 'snapshot_failed' };
      }
    }
    index.versions.push(entry);
    prunePath(pdir, index, at);
    writeIndex(pdir, index);
    pruneSoon();
    return { ok: true, version: entry };
  }

  function list(target) {
    const p = assertLocalPath(target);
    const index = readIndex(pathDir(dir, p));
    return { path: p, versions: index.versions.slice().sort((a, b) => b.id - a.id)
      .map(({ id, createdAt, size, tool, sessionId, skipped, sha256 }) =>
        ({ id, createdAt, size, tool, sessionId, skipped: skipped || false, sha256: sha256 || null })) };
  }

  function findEntry(p, pdir, versionId) {
    const index = readIndex(pdir);
    const entry = index.versions.find((v) => v.id === String(versionId));
    if (!entry) fail('no_version', 'version not found for this file');
    return { index, entry };
  }

  /** Unified-ish diff between the version bytes and the current on-disk content. */
  function diff(target, versionId) {
    const p = assertLocalPath(target);
    const pdir = pathDir(dir, p);
    const { entry } = findEntry(p, pdir, versionId);
    if (entry.skipped) fail('not_snapshot', 'this version was not snapshotted (over the size cap)');
    let oldBytes;
    try { oldBytes = fs.readFileSync(binFor(pdir, entry)); }
    catch (_) { fail('not_snapshot', 'snapshot bytes are gone (pruned or deleted)'); }
    let curBytes = null;
    try { curBytes = fs.readFileSync(p); } catch (_) { /* file deleted since — diff against nothing */ }
    const decode = (bytes) => {
      if (!bytes) return { text: '', empty: true };
      if (bytes.includes(0)) return { binary: true };
      return { text: bytes.toString('utf8') };
    };
    const a = decode(oldBytes);
    const b = curBytes ? decode(curBytes) : { text: '', empty: true };
    if (a.binary || b.binary) return { ok: true, binary: true, size: entry.size };
    // old = current on-disk content, new = the selected version: "del" lines
    // are what restoring removes, "add" lines are what it brings back
    const d = diffLines(b.text, a.text);
    if (d.lines === null) return { ok: true, tooLarge: true, added: d.added, removed: d.removed };
    return { ok: true, added: d.added, removed: d.removed, lines: d.lines };
  }

  /** Overwrite the target with the version bytes. The current content is
   *  snapshotted first ('restore-pre') so a rollback is itself undoable. */
  function restore(target, versionId) {
    const p = assertLocalPath(target);
    const pdir = pathDir(dir, p);
    const { entry } = findEntry(p, pdir, versionId);
    if (entry.skipped) fail('not_snapshot', 'this version was not snapshotted (over the size cap)');
    let bytes;
    try { bytes = fs.readFileSync(binFor(pdir, entry)); }
    catch (_) { fail('not_snapshot', 'snapshot bytes are gone (pruned or deleted)'); }
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha !== entry.sha256) fail('checksum_mismatch', 'snapshot bytes failed the sha256 check');
    let exists = false;
    try { exists = fs.statSync(p).isFile(); } catch (_) {}
    if (exists) {
      const pre = record(p, { tool: 'restore-pre' });
      if (!pre.ok && pre.reason === 'snapshot_failed') log('warn', 'file-history', 'restore-pre snapshot failed; continuing');
    }
    const tmp = p + '.myagent-restore.tmp';
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, p);
    return { ok: true, path: p, size: bytes.length, restoredVersion: entry.id, preSnapshotted: exists };
  }

  function remove(target, versionId) {
    const p = assertLocalPath(target);
    const pdir = pathDir(dir, p);
    if (versionId === undefined || versionId === null) {
      try { fs.rmSync(pdir, { recursive: true, force: true }); } catch (e) { fail('delete_failed', e.message); }
      return { ok: true, removed: 'all' };
    }
    const { index, entry } = findEntry(p, pdir, versionId);
    dropEntry(pdir, index, entry);
    if (index.versions.length) writeIndex(pdir, index);
    else { try { fs.rmSync(pdir, { recursive: true, force: true }); } catch (_) {} }
    return { ok: true, removed: entry.id };
  }

  return { record, list, diff, restore, delete: remove, pruneAll, _dir: dir };
}

/** RPC-facing layer: restore/delete are gated on the session workspace
 *  (sandbox fail-safe, mirroring artifacts.resolve). */
function createFileHistoryApi({ fileHistory, store, SandboxCtor, defaultRulesFn }) {
  const workspaceOf = (sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId) fail('invalid_params', 'sessionId is required');
    const s = store.getSession(sessionId);
    if (!s) fail('no_session', 'session not found');
    return s.cwd || process.cwd();
  };
  const writableTarget = (target, sessionId) => {
    const p = assertLocalPath(target);
    const workspace = workspaceOf(sessionId);
    const sb = new SandboxCtor(defaultRulesFn(workspace), { workspace });
    let check = p;
    try { check = fs.realpathSync(p); } catch (_) { /* restoring a deleted file uses the literal path */ }
    if (!sb.checkFile(check, 'write').ok) fail('sandbox_denied', 'target is outside the session workspace');
    return check === p ? p : check;
  };
  return {
    list: (p) => fileHistory.list(p.path),
    diff: (p) => fileHistory.diff(p.path, p.versionId),
    restore: (p) => fileHistory.restore(writableTarget(p.path, p.sessionId), p.versionId),
    delete: (p) => fileHistory.delete(writableTarget(p.path, p.sessionId), p.versionId),
  };
}

module.exports = { createFileHistory, createFileHistoryApi, diffLines, assertLocalPath, DEFAULTS };
