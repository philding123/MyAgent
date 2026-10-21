// esbuild bundler for renderer pages (design 01-architecture §6).
import { build } from 'esbuild';
import { mkdirSync, cpSync } from 'fs';
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
await build({ ...common, entryPoints: [path.join(root, 'app/renderer/src/preview.js')], outfile: path.join(outdir, 'preview.js') });
// stylesheets (and KaTeX fonts) the pages link directly — copied next to the
// bundles so the packaged app needs no renderer packages in node_modules
const nm = (p) => path.join(root, 'node_modules', p);
const vendor = path.join(outdir, 'vendor');
cpSync(nm('highlight.js/styles/github-dark.css'), path.join(vendor, 'github-dark.css'));
cpSync(nm('katex/dist/katex.min.css'), path.join(vendor, 'katex.min.css'));
cpSync(nm('katex/dist/fonts'), path.join(vendor, 'fonts'), { recursive: true });
cpSync(nm('@xterm/xterm/css/xterm.css'), path.join(vendor, 'xterm.css'));
console.log('build ok');
