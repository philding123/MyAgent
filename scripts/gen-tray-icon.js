'use strict';
// Generate app/main/tray.png — an ORIGINAL yellow electric-bolt pixel icon
// (electric-mascot palette, not a copy of any existing character; swap the
// file with your own PNG to change it). Deps-free PNG encoder.
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

function encodePng(size, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 16x16 pixel map. . transparent, K outline/dark, Y yellow, W shine
const MAP = [
  '................',
  '..........KK....',
  '.........KYWK...',
  '........KYWYK...',
  '.......KYYYYK...',
  '......KYYYYK....',
  '.....KYYYYK.....',
  '.KKKKYYYYKK.....',
  '.KYYYYYYYK......',
  '..KYYYYYKK......',
  '...KYYYYK.......',
  '..KYYYYK........',
  '.KYYYKK.........',
  '.KYYK...........',
  '.KKK............',
  '................',
];
const COLORS = { K: [43, 43, 43, 255], Y: [255, 216, 38, 255], W: [255, 255, 255, 255] };

for (const row of MAP) {
  if (row.length !== 16) throw new Error('map row must be 16 wide: "' + row + '"');
}

const png = encodePng(16, (x, y) => {
  const c = MAP[y][x];
  return c === '.' ? [0, 0, 0, 0] : COLORS[c];
});

const out = path.join(__dirname, '..', 'app', 'main', 'tray.png');
fs.writeFileSync(out, png);
console.log('tray icon written:', out, png.length + 'B');
