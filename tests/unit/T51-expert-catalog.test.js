'use strict';
// T51 unit: the vendored open-source expert catalog (design/39) — index
// integrity, sha256-verified reads, import-as-preset provenance, tamper
// refusal, re-import dedup. Runs against the REAL vendored market/agency-experts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPresetStore } = require('../../app/daemon/presets');
const { createExpertCatalog } = require('../../app/daemon/expert-catalog');

const CATALOG_DIR = path.join(__dirname, '..', '..', 'market', 'agency-experts');

function makeCatalog(dir = CATALOG_DIR) {
  const presetsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t51-presets-'));
  return { catalog: createExpertCatalog({ dir, presets: createPresetStore(path.join(presetsHome, 'presets')), log: () => {} }), presetsHome };
}

test('T51 vendored index is well-formed with the curated divisions and digests', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'index.json'), 'utf8'));
  assert.equal(idx.metadata.license, 'MIT');
  assert.equal(idx.metadata.upstream, 'https://github.com/msitarzewski/agency-agents');
  assert.match(idx.metadata.commit, /^[0-9a-f]{40}$/);
  assert.ok(idx.experts.length >= 26, 'curated batch shrank: ' + idx.experts.length);
  const divisions = new Set(idx.experts.map((e) => e.division));
  for (const d of ['engineering', 'design', 'product', 'testing', 'security', 'research', 'finance']) assert.ok(divisions.has(d), 'missing division ' + d);
  assert.ok(idx.experts.filter((e) => e.division === 'finance').length >= 5, 'finance batch missing');
  const ids = new Set();
  for (const e of idx.experts) {
    assert.match(e.id, /^[a-z0-9-]+$/, 'bad id ' + e.id);
    assert.ok(!ids.has(e.id), 'duplicate id ' + e.id); ids.add(e.id);
    assert.ok(e.name && e.display_name && e.description_zh && e.emoji, 'zh metadata missing for ' + e.id);
    assert.match(e.sha256, /^[0-9a-f]{64}$/);
    assert.ok(fs.existsSync(path.join(CATALOG_DIR, 'experts', e.id + '.md')), 'file missing for ' + e.id);
    assert.ok(e.homepage.includes(idx.metadata.commit), 'homepage must pin the vendored commit');
  }
  assert.ok(fs.existsSync(path.join(CATALOG_DIR, 'LICENSE')), 'MIT LICENSE vendored');
});

test('T51 list/read expose the persona body verbatim after frontmatter', () => {
  const { catalog } = makeCatalog();
  const ls = catalog.list();
  assert.ok(ls.catalog && ls.catalog.display_name);
  assert.equal(ls.experts.filter((e) => e.installed).length, 0, 'nothing installed yet');
  const e = ls.experts.find((x) => x.id === 'engineering-backend-architect');
  assert.ok(e, 'curated backend architect present');
  const r = catalog.read(e.id);
  assert.equal(r.name, 'Backend Architect');
  assert.ok(r.prompt.length > 400, 'persona body is substantial');
  assert.doesNotMatch(r.prompt.slice(0, 40), /^---/, 'frontmatter stripped from prompt');
  assert.ok(r.license === 'MIT' && r.commit && r.homepage, 'provenance fields present');
  assert.throws(() => catalog.read('no-such-expert'), /unknown expert/);
});

test('T51 import creates a preset with provenance; re-import is already_installed', () => {
  const { catalog, presetsHome } = makeCatalog();
  const r = catalog.importExpert('engineering-code-reviewer');
  assert.equal(r.status, 'installed');
  const presets = createPresetStore(path.join(presetsHome, 'presets')).list();
  assert.equal(presets.length, 1);
  const p = presets[0];
  assert.equal(p.name, 'Code Reviewer');
  assert.equal(p.meta.source, 'builtin:agency-experts/engineering-code-reviewer');
  assert.equal(p.meta.expertId, 'engineering-code-reviewer');
  assert.equal(p.meta.license, 'MIT');
  assert.ok(p.meta.importedAt && p.meta.upstreamCommit, 'import provenance recorded');
  assert.equal(p.prompt, catalog.read('engineering-code-reviewer').prompt, 'prompt is the verbatim body');
  assert.equal(catalog.list().experts.find((e) => e.id === 'engineering-code-reviewer').installed, true);
  const again = catalog.importExpert('engineering-code-reviewer');
  assert.equal(again.status, 'already_installed');
  assert.equal(again.presetId, p.id);
  assert.equal(createPresetStore(path.join(presetsHome, 'presets')).list().length, 1, 'no duplicate preset');
});

test('T51 tampered persona file is refused (sha256 fails closed)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t51-cat-'));
  fs.cpSync(CATALOG_DIR, tmp, { recursive: true });
  const file = path.join(tmp, 'experts', 'research-synthesist.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Research', 'Research ', 'utf8'));
  const { catalog } = makeCatalog(tmp);
  assert.throws(() => catalog.read('research-synthesist'), /tampered/);
  const r = catalog.importExpert('research-synthesist');
  assert.equal(r.status, 'refused');
  assert.match(r.reason, /tampered/);
});
