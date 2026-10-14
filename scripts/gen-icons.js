'use strict';
// Generate the share-target logo PNGs (no deps: raw PNG encoder with node zlib).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // flat #2563eb with a lighter center square (MyAgent-ish mark)
      const o = row + 1 + x * 4;
      const inset = x >= size / 5 && x < size - size / 5 && y >= size / 5 && y < size - size / 5;
      raw[o] = inset ? 0x60 : 0x25;
      raw[o + 1] = inset ? 0xa5 : 0x63;
      raw[o + 2] = inset ? 0xfa : 0xeb;
      raw[o + 3] = 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'share-target', 'assets');
fs.mkdirSync(dir, { recursive: true });
// rgba param kept for future art; current generator draws the mark itself
for (const size of [44, 150]) {
  fs.writeFileSync(path.join(dir, `Square${size}x${size}Logo.png`), png(size));
}
console.log('icons written to', dir);
