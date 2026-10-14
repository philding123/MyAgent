'use strict';
// T10: credential vault — no plaintext at rest (F10).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CredentialVault } = require('../../app/daemon/crypto');

test('T10 vault roundtrip without plaintext on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t10-'));
  const v = new CredentialVault(dir, null);
  assert.strictEqual(v.mode, 'aes-file');
  v.set('llm.apiKey', 'sk-super-secret-123');
  assert.strictEqual(v.get('llm.apiKey'), 'sk-super-secret-123');
  const raw = fs.readFileSync(path.join(dir, 'vault.bin'), 'utf8');
  assert.ok(!raw.includes('sk-super-secret-123'), 'plaintext leaked to disk');
  // reload from disk
  const v2 = new CredentialVault(dir, null);
  assert.strictEqual(v2.get('llm.apiKey'), 'sk-super-secret-123');
});

test('T10 vault delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t10b-'));
  const v = new CredentialVault(dir, null);
  v.set('k', 'v');
  v.delete('k');
  assert.strictEqual(v.get('k'), null);
});
