#!/usr/bin/env node
// Pixel diff for evidence (design/27): pixelmatch a.png vs b.png, write a
// visual diff PNG, and print the mismatch ratio for the comparison report.
// Usage: node scripts/pixel-diff.mjs a.png b.png out-diff.png [threshold]
import fs from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const [aPath, bPath, outPath] = process.argv.slice(2);
const threshold = Number(process.argv[5] ?? process.argv[2 + 2] ?? 0.1);
if (!aPath || !bPath || !outPath) {
  console.error('usage: pixel-diff.mjs <a.png> <b.png> <out.png> [threshold]');
  process.exit(2);
}
const a = PNG.sync.read(fs.readFileSync(aPath));
const b = PNG.sync.read(fs.readFileSync(bPath));
if (a.width !== b.width || a.height !== b.height) {
  // report but still diff on the intersection so evidence is not lost
  console.error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
}
const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
const diff = new PNG({ width: w, height: h });
const n = pixelmatch(a.data, b.data, diff.data, w, h, { threshold });
const total = w * h;
const ratio = n / total;
fs.writeFileSync(outPath, PNG.sync.write(diff));
console.log(JSON.stringify({
  a: aPath, b: bPath, diff: outPath,
  width: w, height: h,
  diffPixels: n, totalPixels: total,
  diffRatio: +ratio.toFixed(4),
  matchPct: +((1 - ratio) * 100).toFixed(2),
}));
