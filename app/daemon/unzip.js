'use strict';
// Minimal pure-JS zip extractor (F12/F25 install path). Replaces the
// PowerShell-only Expand-Archive so skill import works on every platform.
// Supports stored (0) and deflate (8) entries — what every mainstream zipper
// emits for skill packs. Entries escaping dest (zip-slip), symlinks and
// encrypted entries are refused; the whole extract fails closed.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_ENTRIES = 20000;
const MAX_TOTAL = 512 * 1024 * 1024;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('not a zip (no end of central directory)');
}

function listEntries(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error('zip has too many entries');
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt central directory');
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const xlen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const extAttr = buf.readUInt32LE(off + 38);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    out.push({ name, flags, method, csize, usize, local, mode: extAttr >>> 16 });
    off += 46 + nlen + xlen + clen;
  }
  return out;
}

function readEntry(buf, e) {
  if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error('corrupt local header: ' + e.name);
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const data = buf.slice(start, start + e.csize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: Math.max(e.usize, 1) });
  throw new Error('unsupported zip method ' + e.method + ': ' + e.name);
}

/** Extract zipPath into dest. Resolves when all entries are written. */
async function extractZip(zipPath, dest) {
  const buf = fs.readFileSync(zipPath);
  const root = path.resolve(dest);
  const entries = listEntries(buf);
  let total = 0;
  // validate everything first so a bad entry leaves nothing behind
  const plan = entries.map((e) => {
    if (e.flags & 0x1) throw new Error('encrypted zip entry refused: ' + e.name);
    if ((e.mode & 0o170000) === 0o120000) throw new Error('symlink zip entry refused: ' + e.name);
    const rel = e.name.replace(/\\/g, '/');
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('zip entry escapes destination: ' + e.name);
    total += e.usize;
    if (total > MAX_TOTAL) throw new Error('zip too large when extracted');
    return { e, target, dir: rel.endsWith('/') };
  });
  fs.mkdirSync(root, { recursive: true });
  for (const { e, target, dir } of plan) {
    if (dir) { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, readEntry(buf, e));
  }
}

module.exports = { extractZip, listEntries };
