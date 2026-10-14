'use strict';
// Cloud sandbox adapter (F27). e2b-compatible HTTP surface, mirroring the
// WorkBuddy main/e2b-filesystem.js evidence: connect(sandboxId,{apiUrl,headers}),
// fs ops read/write/list/exists/makeDir/remove/rename/getInfo, and auth-error
// reconnect with MIN_RECONNECT_INTERVAL_MS = 10s plus concurrent-reconnect
// dedup (one shared attempt). Auth failures while reconnecting → the tool
// caller receives ok:false (fail-closed); local sandbox stays untouched.

const MIN_RECONNECT_INTERVAL_MS = 10000;

class CloudSandbox {
  /**
   * @param opts {apiUrl, sandboxId, apiKey, fetchImpl?, reconnectFn?}
   *  reconnectFn: optional async () => fresh {apiUrl, sandboxId} config.
   */
  constructor(opts) {
    this.apiUrl = String(opts.apiUrl || '').replace(/\/+$/, '');
    this.sandboxId = opts.sandboxId;
    this.apiKey = opts.apiKey || '';
    this.fetchImpl = opts.fetchImpl || ((u, o) => fetch(u, o));
    this.reconnectFn = opts.reconnectFn || null;
    this.lastReconnectAt = 0;
    this.reconnecting = null; // shared in-flight attempt (evidence: subscribers)
    this.requestTimeoutMs = opts.requestTimeoutMs || 30000;
  }

  headers(extra) {
    return Object.assign({ 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' }, extra || {});
  }

  url(p) { return this.apiUrl + '/sandboxes/' + this.sandboxId + p; }

  isAuthError(e) {
    const status = e && (e.status || e.statusCode || (e.response && e.response.status));
    if (status === 401 || status === 403) return true;
    const msg = String((e && e.message) || '').toLowerCase();
    return msg.includes('unauthorized') || msg.includes('token expired') || msg.includes('authentication');
  }

  canAttemptReconnect() { return Date.now() - this.lastReconnectAt >= MIN_RECONNECT_INTERVAL_MS; }

  /** Single shared reconnect (WorkBuddy evidence: subscribers queue on one attempt). */
  async reconnect() {
    if (this.reconnecting) return this.reconnecting;
    if (!this.reconnectFn) throw new Error('no reconnect fn');
    if (!this.canAttemptReconnect()) throw new Error('reconnect not allowed yet (10s interval)');
    this.lastReconnectAt = Date.now();
    this.reconnecting = (async () => {
      const fresh = await this.reconnectFn();
      if (fresh && fresh.sandboxId) this.sandboxId = fresh.sandboxId;
      if (fresh && fresh.apiUrl) this.apiUrl = String(fresh.apiUrl).replace(/\/+$/, '');
      if (fresh && fresh.apiKey) this.apiKey = fresh.apiKey;
      // probe to confirm the new identity actually authenticates
      const res = await this.fetchImpl(this.url('/files/exists?path=/'), { headers: this.headers(), timeout: this.requestTimeoutMs });
      if (!res.ok) { const e = new Error('reconnect probe failed: ' + res.status); e.status = res.status; throw e; }
      return true;
    })();
    try {
      return await this.reconnecting;
    } finally {
      this.reconnecting = null;
    }
  }

  async exec(op) {
    try {
      return await op();
    } catch (e) {
      if (!this.isAuthError(e)) throw e;
      // Auth error: join an in-flight reconnect, or start one when the 10s
      // window allows; then retry the op once. A throttled (or failed)
      // reconnect propagates — fail-closed, never a silent local fallback.
      if (this.reconnecting) {
        await this.reconnecting;
      } else if (this.canAttemptReconnect()) {
        await this.reconnect();
      } else {
        throw e;
      }
      return op();
    }
  }

  async request(method, path, body) {
    return this.exec(async () => {
      const res = await this.fetchImpl(this.url(path), {
        method, headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        timeout: this.requestTimeoutMs,
      });
      if (!res.ok) { const e = new Error('cloud sandbox ' + method + ' ' + path + ' -> ' + res.status); e.status = res.status; throw e; }
      if (res.status === 204) return null;
      return res.json();
    });
  }

  // fs surface (evidence: read/write/list/exists/makeDir/remove/rename/getInfo)
  async read(path, format) {
    const r = await this.request('GET', '/files/content?path=' + encodeURIComponent(path) + (format ? '&format=' + format : ''));
    return r && (r.content !== undefined ? r : r);
  }
  async write(path, content, opts) {
    return this.request('POST', '/files', { path, content, format: (opts && opts.format) || 'text' });
  }
  async list(path, opts) { return this.request('GET', '/files?path=' + encodeURIComponent(path) + (opts && opts.depth ? '&depth=' + opts.depth : '')); }
  async exists(path) { const r = await this.request('GET', '/files/exists?path=' + encodeURIComponent(path)); return !!(r && r.exists); }
  async makeDir(path) { return this.request('POST', '/files/mkdir', { path }); }
  async remove(path, opts) { return this.request('DELETE', '/files?path=' + encodeURIComponent(path) + (opts && opts.recursive ? '&recursive=true' : '')); }
  async rename(oldPath, newPath) { return this.request('POST', '/files/rename', { oldPath, newPath }); }
  async getInfo(path) { return this.request('GET', '/files/info?path=' + encodeURIComponent(path)); }

  /** command surface for run_command on the cloud backend */
  async execCommand(command, opts) {
    const r = await this.request('POST', '/commands/run', { command, cwd: opts && opts.cwd, timeoutMs: opts && opts.timeoutMs });
    return { code: (r && r.exitCode) ?? 0, stdout: String((r && r.stdout) || ''), stderr: String((r && r.stderr) || '') };
  }
}

module.exports = { CloudSandbox, MIN_RECONNECT_INTERVAL_MS };
