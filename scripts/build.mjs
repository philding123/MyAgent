// esbuild bundler for renderer pages (design 01-architecture §6).
import { build } from 'esbuild';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, 'app', 'renderer', 'dist');
mkdirSync(outdir, { recursive: true });

const common = {
  bundle: true,
  minify: false,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
};

await build({ ...common, entryPoints: [path.join(root, 'app/renderer/src/app.js')], outfile: path.join(outdir, 'bundle.js') });
await build({ ...common, entryPoints: [path.join(root, 'app/renderer/src/settings.js')], outfile: path.join(outdir, 'settings.js') });
await build({ ...common, entryPoints: [path.join(root, 'app/renderer/src/search.js')], outfile: path.join(outdir, 'search.js') });
console.log('build ok');
