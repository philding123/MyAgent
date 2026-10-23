'use strict';
// Auto-updater (F21). Manifest-driven check + download + sha256 verify, with
// WorkBuddy-style silent apply semantics (design/21-updater.md). The Electron
// transition window is delegated to scripts/update/*.vbs+.ps1, adapted from
// WorkBuddy's resources/scripts/update-progress.* evidence (close strategy:
// new main window visible / installer gone + fade / defensive caps).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { unpacked } = require('../shared/asar-path');

function compareSemver(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

class Updater {
  /**
   * @param opts {manifestUrl, currentVersion, fetchImpl?, fetchFn?, emit?, platform?}
   *  fetchImpl: injectable fetch for tests; emit(stage, payload) progress hook.
   */
  constructor(opts) {
    this.manifestUrl = opts.manifestUrl || '';
    this.currentVersion = opts.currentVersion || '0.0.0';
    this.fetchFn = opts.fetchImpl || opts.fetchFn || ((u, o) => fetch(u, o));
    this.emit = opts.emit || (() => {});
    this.state = { stage: 'idle', enabled: !!opts.manifestUrl, manifest: null,
      downloadedFile: null, lastCheck: null, lastError: null };
    this.tmpDir = path.join(os.tmpdir(), 'myagent-update');
  }

  setState(patch) { Object.assign(this.state, patch); this.emit('update', { ...this.state }); }

  async check() {
    if (!this.manifestUrl) {
      this.setState({ stage: 'disabled', lastError: null });
      return { ok: false, reason: 'disabled' };
    }
    this.setState({ stage: 'check', lastError: null });
    try {
      const res = await this.fetchFn(this.manifestUrl, { timeout: 15000 });
      if (!res.ok) throw new Error('manifest http ' + res.status);
      const manifest = JSON.parse(String(await res.text()));
      for (const k of ['version', 'url', 'sha256']) {
        if (!manifest[k]) throw new Error('manifest missing field: ' + k);
      }
      this.setState({ stage: 'checked', manifest, lastCheck: new Date().toISOString() });
      const newer = compareSemver(manifest.version, this.currentVersion) > 0;
      return { ok: true, updateAvailable: newer, version: manifest.version, notes: manifest.notes || '' };
    } catch (e) {
      this.setState({ stage: 'error', lastError: String(e.message || e) });
      return { ok: false, reason: String(e.message || e) };
    }
  }

  async download() {
    if (!this.state.manifest) return { ok: false, reason: 'no manifest (run check first)' };
    this.setState({ stage: 'download' });
    try {
      fs.mkdirSync(this.tmpDir, { recursive: true });
      const res = await this.fetchFn(this.state.manifest.url, { timeout: 120000 });
      if (!res.ok) throw new Error('download http ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const file = path.join(this.tmpDir, path.basename(new URL(this.state.manifest.url).pathname) || 'update.bin');
      fs.writeFileSync(file, buf);
      this.setState({ stage: 'downloaded', downloadedFile: file });
      return this.verify(file);
    } catch (e) {
      this.setState({ stage: 'error', lastError: String(e.message || e) });
      return { ok: false, reason: String(e.message || e) };
    }
  }

  verify(file) {
    this.setState({ stage: 'verify' });
    const sum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (sum !== String(this.state.manifest.sha256).toLowerCase()) {
      try { fs.rmSync(file, { force: true }); } catch (_) {}
      this.setState({ stage: 'error', downloadedFile: null, lastError: 'sha256 mismatch: ' + sum });
      return { ok: false, reason: 'sha256 mismatch' };
    }
    this.setState({ stage: 'ready' });
    return { ok: true, file, version: this.state.manifest.version };
  }

  /** Apply a downloaded update. exe → detached installer; zip → staged swap via update.bat. */
  apply({ appRoot, exeName, quitFn, spawnImpl, transition }) {
    const doSpawn = spawnImpl || spawn;
    if (this.state.stage !== 'ready' || !this.state.downloadedFile) {
      return { ok: false, reason: 'nothing ready to apply' };
    }
    const file = this.state.downloadedFile;
    this.spawnTransitionWindow(transition);
    if (/\.exe$/i.test(file)) {
      doSpawn(file, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // portable zip: write a batch that waits for this process to exit, swaps
      // the tree and relaunches; then quit so the batch can proceed.
      const stage = path.join(this.tmpDir, 'staged');
      const bat = path.join(this.tmpDir, 'apply-update.bat');
      fs.rmSync(stage, { recursive: true, force: true });
      fs.mkdirSync(stage, { recursive: true });
      const { execFileSync } = require('child_process');
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${file}' -DestinationPath '${stage}' -Force`], { timeout: 120000 });
      fs.writeFileSync(bat, [
        '@echo off',
        `:waitloop`,
        `tasklist /FI "IMAGENAME eq ${exeName}" | find /I "${exeName}" >nul && (timeout /t 1 /nobreak >nul & goto waitloop)`,
        `xcopy /E /Y /I "${stage}\\*" "${appRoot}\\" >nul`,
        `start "" "${path.join(appRoot, exeName)}"`,
        'del "%~f0"',
      ].join('\r\n'), 'utf8');
      doSpawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
    this.setState({ stage: 'applied' });
    if (quitFn) setTimeout(quitFn, 300);
    return { ok: true };
  }

  /** WorkBuddy evidence mechanism: wscript VBS relay → hidden PowerShell WinForms. */
  spawnTransitionWindow(opts) {
    try {
      const dir = (opts && opts.scriptDir) || unpacked(path.join(__dirname, '..', '..', 'scripts', 'update'));
      const vbs = path.join(dir, 'update-transition.vbs');
      const ps1 = path.join(dir, 'update-transition.ps1');
      if (!fs.existsSync(vbs) || !fs.existsSync(ps1)) return false;
      const o = opts || {};
      spawn('wscript.exe', [vbs, ps1,
        '-AppProcessName', path.basename(process.execPath, '.exe'),
        '-OldAppProcessId', String(process.pid),
        '-TimeoutSeconds', String(o.timeoutSeconds ?? 120),
        '-MaxInstallSeconds', String(o.maxInstallSeconds ?? 600),
        '-DetectStartSeconds', String(o.detectStartSeconds ?? 3),
        '-FadeMs', String(o.fadeMs ?? 3000),
      ], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return true;
    } catch (_) { return false; }
  }

  status() {
    return { ...this.state, currentVersion: this.currentVersion };
  }
}

module.exports = { Updater, compareSemver };
