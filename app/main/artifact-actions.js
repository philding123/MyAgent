'use strict';
const path = require('path');
const { fileURLToPath } = require('url');
const { isSafeOpenPath } = require('../shared/artifacts');

const failure = (code, message) => ({ ok: false, error: { code, message } });

// A trusted IPC source is not proof of a user gesture. No model tool routes to
// this handler; every open still requires an independent native confirmation.
function isArtifactSender(event, windows, rendererFile) {
  try {
    const win = windows.get('main');
    if (!win || win.isDestroyed() || event.sender !== win.webContents
      || event.senderFrame !== event.sender.mainFrame) return false;
    const url = new URL(event.senderFrame.url);
    const current = new URL(event.sender.getURL());
    const isLocal = (u) => u.protocol === 'file:' && !u.host
      && path.resolve(fileURLToPath(u)) === path.resolve(rendererFile);
    return isLocal(url) && isLocal(current);
  } catch (_) { return false; }
}

function createArtifactActions({ request, shell, clipboard, confirmOpen, isTrustedSender,
  seams = null, timeoutMs = 120000 }) {
  async function approved(target, event) {
    if (seams) return seams.responses.length ? seams.responses.shift() === true : false;
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => confirmOpen(target, event, controller.signal)).then((r) => r === true, () => false),
        new Promise((resolve) => { timer = setTimeout(() => { resolve(false); controller.abort(); }, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  return async function artifactAction(event, req) {
    try {
      if (!isTrustedSender(event)) return failure('forbidden_sender', 'artifact actions require the trusted main window');
      if (!req || !['reveal', 'open', 'copy'].includes(req.operation)
        || typeof req.sessionId !== 'string' || !req.sessionId || typeof req.path !== 'string' || !req.path) {
        return failure('invalid_params', 'invalid artifact action');
      }
      const params = { sessionId: req.sessionId, path: req.path, operation: req.operation };
      const result = await request('artifacts.resolve', params);
      if (!result || !result.ok) return failure(result?.error?.code || 'resolve_failed', result?.error?.message || 'artifact resolution failed');
      let target = result.result;
      if (!target || typeof target.path !== 'string') return failure('resolve_failed', 'invalid artifact target');
      if (req.operation === 'open') {
        if (!isSafeOpenPath(target.path)) return failure('unsafe_type', 'default-application open is not allowed for this file type');
        if (!await approved(target, event)) return failure('denied', 'open was not approved or confirmation timed out');
        // Confirmation may last two minutes: revalidate registration, policy and
        // filesystem afterwards. Refuse a changed symlink destination.
        const again = await request('artifacts.resolve', params);
        if (!again?.ok) return failure(again?.error?.code || 'resolve_failed', again?.error?.message || 'artifact resolution failed');
        if (again.result?.path !== target.path) return failure('artifact_changed', 'artifact target changed during confirmation');
        target = again.result;
        if (!isSafeOpenPath(target.path)) return failure('unsafe_type', 'unsafe resolved file type');
      }
      if (!isTrustedSender(event)) return failure('forbidden_sender', 'artifact action source changed');
      if (seams) seams.artifacts.push({ ...params, path: target.path });
      else if (req.operation === 'copy') clipboard.writeText(target.path);
      else if (req.operation === 'reveal') shell.showItemInFolder(target.path);
      else {
        const error = await shell.openPath(target.path);
        if (error) return failure('native_error', error);
      }
      return { ok: true, path: target.path };
    } catch (e) { return failure('native_error', String(e.message || e)); }
  };
}

module.exports = { createArtifactActions, isArtifactSender };
