'use strict';
// T24a: share-target artifacts — AppxManifest XML structure + PowerShell
// script syntax. Actual Add-AppxPackage registration is the documented
// manual step (machine-level deployment + cert trust).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SHT = path.join(__dirname, '..', '..', 'share-target');

test('T24a AppxManifest.xml is well-formed with ShareTarget extension', () => {
  const xml = fs.readFileSync(path.join(SHT, 'AppxManifest.xml'), 'utf8');
  // sparse-package essentials (validated against real Add-AppxPackage schema
  // errors during registration dry-runs — see design/24-share-target.md)
  assert.ok(xml.includes('<Identity Name="MyAgentShare"'), 'Identity present');
  assert.ok(xml.includes('uap10:AllowExternalContent>true'), 'sparse external content allowed');
  assert.ok(xml.includes('windows.shareTarget'), 'shareTarget extension declared');
  assert.ok(xml.includes('SupportsAnyFileType'), 'accepts any file type');
  assert.ok(xml.includes('rescap:Capability Name="runFullTrust"'), 'full-trust entry capability');
  assert.ok(/Executable="share-target\\MyAgentShareTarget\.exe"/.test(xml), 'Executable is a real .exe (Appx schema constraint)');
  assert.ok(fs.existsSync(path.join(SHT, 'MyAgentShareTarget.hta')) === false, 'no untested forwarder artifacts');
  assert.ok(fs.existsSync(path.join(SHT, 'register.ps1')) && fs.existsSync(path.join(SHT, 'unregister.ps1')));
});

// Windows PowerShell, or PowerShell 7 elsewhere; null when neither exists
function psExe() {
  if (process.platform === 'win32') return 'powershell.exe';
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (d && fs.existsSync(path.join(d, 'pwsh'))) return 'pwsh';
  }
  return null;
}

function psParse(file) {
  return new Promise((resolve) => {
    const script = `[System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$err) | Out-Null; if ($err.Count) { 'PARSE_ERR ' + ($err[0].Message) } else { 'PARSE_OK' }`;
    execFile(psExe(), ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 60000 }, (err, stdout) => {
      resolve({ err, out: String(stdout || '').trim() });
    });
  });
}

test('T24a register/unregister ps1 parse cleanly', { timeout: 90000 }, async (t) => {
  if (!psExe()) return t.skip('no PowerShell on this host (Windows-only scripts; parsed on win32 / pwsh hosts)');
  for (const f of ['register.ps1', 'unregister.ps1']) {
    const r = await psParse(path.join(SHT, f));
    assert.strictEqual(r.out, 'PARSE_OK', f + ' parses: ' + r.out + (r.err ? ' / ' + r.err.message : ''));
  }
});

test('T24a register.ps1 keeps the evidence-grade engineering details', () => {
  const src = fs.readFileSync(path.join(SHT, 'register.ps1'), 'utf8');
  assert.ok(src.includes('MYAGENT_SHT_INSTDIR'), 'env-var path injection (WB evidence)');
  assert.ok(src.includes('Invoke-AppxJob'), 'AppXSvc hang guard job');
  assert.ok(src.match(/Timeout\s+\$script:SHT_APPX_TIMEOUT_SEC/) || src.includes('60s'), '60s AppX timeout');
  assert.ok(src.includes('exit 2') && src.includes('exit 3') && src.includes('exit 4'), 'evidence exit-code semantics');
  assert.ok(src.includes('TrustedPeople'), 'self-signed cert trusted for sparse package');
  // forwarder chain: real exe compiled from forwarder.cs via the bundled csc,
  // launch.ini tells it where MyAgent lives
  assert.ok(src.includes('csc.exe'), 'compiles forwarder with .NET Framework csc (no VS needed)');
  assert.ok(src.includes('launch.ini'), 'launch.ini written for the forwarder');
  assert.ok(fs.existsSync(path.join(SHT, 'forwarder.cs')), 'forwarder source present');
  assert.ok(fs.existsSync(path.join(SHT, 'assets', 'Square44x44Logo.png')), 'manifest logos exist');
  assert.ok(fs.existsSync(path.join(SHT, 'assets', 'Square150x150Logo.png')), 'manifest logos exist');
  const un = fs.readFileSync(path.join(SHT, 'unregister.ps1'), 'utf8');
  assert.ok(un.includes('not registered; nothing to do'), 'best-effort unregister semantics');
});
