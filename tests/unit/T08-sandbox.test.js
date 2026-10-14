'use strict';
// T08: file sandbox rule engine — WorkBuddy tsbx_rules.json equivalence cases.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { Sandbox, globToRegExp } = require('../../app/daemon/sandbox');

const home = os.homedir();
const ws = path.join(os.tmpdir(), 't08-workspace');

const wbLike = {
  version: 1,
  file_rules: [
    { path: '%USERPROFILE%\\.ssh\\**', action: 'read=deny|write=deny|delete=deny', _comment: 'protect credentials' },
    { path: '%USERPROFILE%\\.gnupg\\**', action: 'read=deny|write=deny|delete=deny' },
    { path: '%TEMP%\\**', action: 'read=allow|write=allow|delete=allow', _comment: 'temp' },
    { path: '%WORKSPACE%\\**', action: 'read=allow|write=allow|delete=allow', _comment: 'workspace' },
  ],
};

const sb = new Sandbox(wbLike, { workspace: ws });

test('T08 credentials dir is fully denied (WorkBuddy tsbx parity)', () => {
  for (const op of ['read', 'write', 'delete']) {
    assert.strictEqual(sb.checkFile(path.join(home, '.ssh', 'id_rsa'), op).ok, false, op);
    assert.strictEqual(sb.checkFile(path.join(home, '.gnupg', 'secring.gpg'), op).ok, false, op);
  }
});

test('T08 temp + workspace allowed for all ops', () => {
  for (const op of ['read', 'write', 'delete']) {
    assert.strictEqual(sb.checkFile(path.join(os.tmpdir(), 'x.txt'), op).ok, true, 'temp ' + op);
    assert.strictEqual(sb.checkFile(path.join(ws, 'sub', 'y.txt'), op).ok, true, 'ws ' + op);
  }
});

test('T08 outside workspace defaults to read-only (fail-safe)', () => {
  const outside = path.join(home, 'Documents', 'x.txt');
  assert.strictEqual(sb.checkFile(outside, 'read').ok, true);
  assert.strictEqual(sb.checkFile(outside, 'write').ok, false);
  assert.strictEqual(sb.checkFile(outside, 'delete').ok, false);
});

test('T08 ** crosses segments, * stays within one', () => {
  const re = globToRegExp(path.join(ws, '**'));
  assert.ok(re.test(path.join(ws, 'a', 'b', 'c.txt')));
  assert.ok(re.test(ws + '/a.txt'.replace('/', path.sep)) || re.test(path.join(ws, 'a.txt')));
  const single = globToRegExp(path.join(ws, '*.txt'));
  assert.ok(single.test(path.join(ws, 'a.txt')));
  assert.ok(!single.test(path.join(ws, 'sub', 'a.txt')));
});

test('T08 command rules deny/confirm/allow', () => {
  const sb2 = new Sandbox({ file_rules: wbLike.file_rules, command_rules: {
    deny_patterns: ['\\brm\\s+-rf\\b'], confirm_patterns: ['\\bgit\\s+push\\b'] } }, { workspace: ws });
  assert.strictEqual(sb2.checkCommand('rm -rf /').verdict, 'deny');
  assert.strictEqual(sb2.checkCommand('git push origin main').verdict, 'confirm');
  assert.strictEqual(sb2.checkCommand('echo hello').verdict, 'allow');
});

test('T08 default rules protect .ssh and keystore', () => {
  const { defaultRules } = require('../../app/daemon/sandbox');
  const sb3 = new Sandbox(defaultRules(ws), { workspace: ws });
  assert.strictEqual(sb3.checkFile(path.join(home, '.ssh', 'id_ed25519'), 'read').ok, false);
  const appdata = process.env.APPDATA || path.join(home, '.config');
  assert.strictEqual(sb3.checkFile(path.join(appdata, 'myagent', 'keystore', 'vault.bin'), 'read').ok, false);
});
