#!/usr/bin/env node
// Pixel comparison runner (design/27 evidence): diff each WorkBuddy baseline
// against the MyAgent capture of the same surface, write diff images and a
// machine-readable summary for the comparison report.
// Usage: node scripts/pixel-compare.mjs [evidenceDir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(process.argv[2] || 'artifacts/pixel-evidence');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SURFACES = [
  { name: 'main', w: 1280, h: 800 },
  { name: 'settings', w: 900, h: 680 },
  { name: 'search', w: 800, h: 640 },
  { name: 'preview', w: 980, h: 720 },
  { name: 'settings-dark', w: 900, h: 680 },
  { name: 'search-dark', w: 800, h: 640 },
];

const results = [];
for (const s of SURFACES) {
  const a = path.join(DIR, `wb-${s.name}.png`);
  const b = path.join(DIR, `my-${s.name}.png`);
  const d = path.join(DIR, `diff-${s.name}.png`);
  if (!fs.existsSync(a) || !fs.existsSync(b)) {
    results.push({ surface: s.name, error: 'missing capture', a, b });
    continue;
  }
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'pixel-diff.mjs'), a, b, d], { encoding: 'utf8' });
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  const parsed = line ? JSON.parse(line) : { error: out };
  results.push({ surface: s.name, viewport: `${s.w}x${s.h}`, ...parsed });
}
fs.writeFileSync(path.join(DIR, 'comparison.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
