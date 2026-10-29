'use strict';
const fs = require('fs');
const path = require('path');
const { Sandbox, defaultRules } = require('./sandbox');
const { collectArtifacts, isSafeOpenPath } = require('../shared/artifacts');

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

function createArtifactRegistry(store) {
  function session(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) fail('invalid_params', 'sessionId is required');
    const s = store.getSession(sessionId);
    if (!s) fail('no_session', 'session not found');
    return s;
  }
  function list({ sessionId }) {
    session(sessionId);
    return collectArtifacts(store.listMessages(sessionId), sessionId);
  }
  function resolve({ sessionId, path: target, operation }) {
    const s = session(sessionId);
    if (!['preview', 'reveal', 'open', 'copy'].includes(operation) || typeof target !== 'string') {
      fail('invalid_params', 'invalid artifact operation or path');
    }
    const artifact = list({ sessionId }).find((a) => a.path === target);
    if (!artifact) fail('not_artifact', 'file is not registered to this session');
    if (artifact.location !== 'local') fail('remote_artifact', 'remote artifacts are not local files');
    // Never hand UNC/network URLs, device paths or Windows alternate streams to
    // native APIs. Check this before realpath to avoid network filesystem access.
    if (!path.isAbsolute(target) || /^[\\/]{2}/.test(target)
      || /:/.test(target.replace(/^[A-Za-z]:/, ''))) fail('unsafe_path', 'not a local absolute file path');
    const workspace = s.cwd || process.cwd();
    const sb = new Sandbox(defaultRules(workspace), { workspace });
    if (!sb.checkFile(target, 'read').ok) fail('sandbox_denied', 'sandbox denied artifact');
    let real;
    try { real = fs.realpathSync(target); }
    catch (e) { fail(e.code === 'ENOENT' ? 'not_found' : 'file_unavailable', 'artifact is unavailable'); }
    if (/^[\\/]{2}/.test(real) || !sb.checkFile(real, 'read').ok) fail('sandbox_denied', 'sandbox denied resolved artifact');
    let stat;
    try { stat = fs.statSync(real); } catch (_) { fail('file_unavailable', 'artifact is unavailable'); }
    if (!stat.isFile()) fail('not_file', 'artifact is not a regular file');
    // Validate both the registered name and resolved extension (symlink swaps).
    if (operation === 'open' && (!isSafeOpenPath(target) || !isSafeOpenPath(real))) {
      fail('unsafe_type', 'default-application open is not allowed for this file type');
    }
    return { path: real, name: path.basename(real) };
  }
  return { list, resolve };
}

module.exports = { createArtifactRegistry };
