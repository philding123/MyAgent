'use strict';
// Credential protection (F10): encrypt secrets at rest. Prefer Electron
// safeStorage (DPAPI on Windows); fall back to AES-256-GCM with a local
// keyfile. The engine sandbox denies reads to this directory.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function safeStorageAvailable() {
  try {
    // eslint-disable-next-line global-require
    const { safeStorage } = require('electron');
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch (_) { return false; }
}

class CredentialVault {
  /**
   * @param dir e.g. %APPDATA%/myagent/keystore
   * @param electronSafeStorage the electron.safeStorage object or null
   */
  constructor(dir, electronSafeStorage) {
    this.dir = dir;
    this.ss = electronSafeStorage && electronSafeStorage.isEncryptionAvailable ? electronSafeStorage : null;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'vault.bin');
    this.entries = {};
    if (fs.existsSync(this.file)) {
      try { this.entries = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { this.entries = {}; }
    }
    this.mode = this.ss ? 'safeStorage' : 'aes-file';
    if (!this.ss) {
      this.keyPath = path.join(dir, 'keystore.key');
      if (!fs.existsSync(this.keyPath)) fs.writeFileSync(this.keyPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
      this.key = Buffer.from(fs.readFileSync(this.keyPath, 'utf8'), 'hex');
    }
  }

  _encrypt(plain) {
    if (this.ss) return 'ss:' + this.ss.encryptString(plain).toString('base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'aes:' + iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
  }

  _decrypt(stored) {
    if (stored.startsWith('ss:')) {
      if (!this.ss) throw new Error('safeStorage entry but unavailable');
      return this.ss.decryptString(Buffer.from(stored.slice(3), 'base64'));
    }
    const [, ivB, tagB, dataB] = stored.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
  }

  set(name, secret) {
    this.entries[name] = this._encrypt(String(secret));
    this._flush();
  }
  get(name) {
    const v = this.entries[name];
    return v === undefined ? null : this._decrypt(v);
  }
  delete(name) { delete this.entries[name]; this._flush(); }
  names() { return Object.keys(this.entries); }
  _flush() { fs.writeFileSync(this.file, JSON.stringify(this.entries)); }
}

module.exports = { CredentialVault, safeStorageAvailable };
