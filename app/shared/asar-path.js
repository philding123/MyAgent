'use strict';
// Packaged builds (electron-builder) put the app in resources/app.asar and the
// asarUnpack'd trees next to it in app.asar.unpacked. Anything copied with
// fs.cpSync, executed by a child process, or handed to an external program
// (wscript, a skill's python script) must use the unpacked real path; reads
// through Electron's asar shim are fine either way. Dev checkouts: no-op.

const fs = require('fs');
const path = require('path');

const ASAR = path.sep + 'app.asar' + path.sep;

function unpacked(p) {
  const s = String(p);
  if (!s.includes(ASAR)) return s;
  const real = s.replace(ASAR, path.sep + 'app.asar.unpacked' + path.sep);
  return fs.existsSync(real) ? real : s;
}

module.exports = { unpacked };
