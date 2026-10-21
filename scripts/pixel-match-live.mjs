#!/usr/bin/env node
// Live-baseline match (design/35): box-downsample a wb CDP capture taken at a
// device scale factor (wb-live-*.png, e.g. 1920×1200 for a 1280×800 viewport)
// to CSS pixels, then pixelmatch against a MyAgent shot of the same viewport.
// Usage: node scripts/pixel-match-live.mjs <wb.png> <my.png> [diff.png] [--w 1280 --h 800] [--t 0.02]
import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const W = +opt('--w', 1280), H = +opt('--h', 800), T = +opt('--t', 0.1);
const [wbPath, myPath, out] = args;
if (!wbPath || !myPath) { console.error('usage: pixel-match-live.mjs <wb.png> <my.png> [diff.png]'); process.exit(2); }
const src = PNG.sync.read(fs.readFileSync(wbPath));
const f = src.width / W;
const wb = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const acc = [0, 0, 0, 0]; let n = 0;
  for (let yy = Math.floor(y * f); yy < Math.floor((y + 1) * f); yy++) {
    for (let xx = Math.floor(x * f); xx < Math.floor((x + 1) * f); xx++) {
      const i = (src.width * yy + xx) << 2;
      for (let k = 0; k < 4; k++) acc[k] += src.data[i + k];
      n++;
    }
  }
  const o = (W * y + x) << 2;
  for (let k = 0; k < 4; k++) wb.data[o + k] = acc[k] / n;
}
const my = PNG.sync.read(fs.readFileSync(myPath));
const diff = new PNG({ width: W, height: H });
const n = pixelmatch(wb.data, my.data, diff.data, W, H, { threshold: T });
if (out) fs.writeFileSync(out, PNG.sync.write(diff));
console.log(JSON.stringify({ wb: wbPath, my: myPath, threshold: T, matchPct: +((1 - n / (W * H)) * 100).toFixed(2) }));
