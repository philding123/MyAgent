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
  const { XMLParser } = (() => { try { return require('fast-xml-parser'); } catch (_) { return {}; } })();
  const xml = fs.readFileSync(path.join(SHT, 'AppxManifest.xml'), 'utf8');
  if (XMLParser) {
    const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
    assert.ok(doc.Package.Identity, 'Identity present');
    assert.strictEqual(doc.Package.Identity['@_Name'], 'MyAgentShare');
    const apps = doc.Package.Applications.Application;
    assert.ok(apps, 'Application present');
    const ext = JSON.stringify(apps);
    assert.ok(ext.includes('windows.shareTarget'), 'shareTarget extension declared');
    assert.ok(ext.includes('SupportsAnyFileType'), 'accepts any file type');
  } else {
    // no parser dep: structural string assertions still pin the essentials
    assert.ok(xml.includes('<Identity Name="MyAgentShare"'));
    assert.ok(xml.includes('windows.shareTarget'));
    assert.ok(xml.includes('SupportsAnyFileType'));
  }
  assert.ok(fs.existsSync(path.join(SHT, 'MyAgentShareTarget.cmd')), 'helper cmd exists');
  const cmd = fs.readFileSync(path.join(SHT, 'MyAgentShareTarget.cmd'), 'utf8');
  assert.ok(cmd.includes('--share'), 'cmd forwards --share to the main exe');
});

function psParse(file) {
  return new Promise((resolve) => {
    const script = `[System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$err) | Out-Null; if ($err.Count) { 'PARSE_ERR ' + ($err[0].Message) } else { 'PARSE_OK' }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 60000 }, (err, stdout) => {
      resolve({ err, out: String(stdout || '').trim() });
    });
  });
}

test('T24a register/unregister ps1 parse cleanly', { timeout: 90000 }, async () => {
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
  const un = fs.readFileSync(path.join(SHT, 'unregister.ps1'), 'utf8');
  assert.ok(un.includes('not registered; nothing to do'), 'best-effort unregister semantics');
});
