'use strict';
// electron-builder afterPack (design/37): on Linux, Chromium checks its
// sandbox helper BEFORE any app JS runs, so the app's own
// app.commandLine.appendSwitch('no-sandbox') (app/main/index.js — a deliberate,
// documented trade-off) is too late: on distros that restrict unprivileged
// user namespaces (Ubuntu 24.04+) the AppImage/unpacked build aborts with
// "The SUID sandbox helper binary was found, but is not configured correctly".
// Make the packaged executable a launcher that passes --no-sandbox itself.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const name = context.packager.executableName;
  const exe = path.join(context.appOutDir, name);
  const real = exe + '.bin';
  if (fs.existsSync(real)) return; // already wrapped
  fs.renameSync(exe, real);
  fs.writeFileSync(exe, [
    '#!/bin/sh',
    '# MyAgent launcher: start Electron with --no-sandbox (see build/after-pack.cjs)',
    'HERE="$(dirname "$(readlink -f "$0")")"',
    `exec "$HERE/${name}.bin" --no-sandbox "$@"`,
    '',
  ].join('\n'));
  fs.chmodSync(exe, 0o755);
};
