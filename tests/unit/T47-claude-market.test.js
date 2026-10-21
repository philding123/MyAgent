'use strict';
// T47a: builtin Claude skills catalog (F53) — vendored index integrity,
// license split, YAML block-scalar frontmatter, tamper refusal.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Market, treeHash, loadBuiltin } = require('../../app/daemon/market');
const { parseFrontmatter, installSkill, scanSkillDir } = require('../../app/daemon/skills');

const CATALOG = path.join(__dirname, '..', '..', 'market', 'claude-skills');

test('T47a frontmatter parses YAML block scalars and quoted values', () => {
  const folded = parseFrontmatter('---\nname: a\ndescription: >\n  line one\n  line two\n\n  para two\nlicense: x\n---\nbody');
  assert.strictEqual(folded.meta.description, 'line one line two\n\npara two');
  assert.strictEqual(folded.meta.license, 'x');
  const literal = parseFrontmatter('---\nname: b\ndescription: |-\n  keep\n  lines\n---\n');
  assert.strictEqual(literal.meta.description, 'keep\nlines');
  const quoted = parseFrontmatter('---\nname: c\ndescription: "say \\"hi\\": ok"\nother: \'it\'\'s\'\n---\n');
  assert.strictEqual(quoted.meta.description, 'say "hi": ok');
  assert.strictEqual(quoted.meta.other, "it's");
  // our own builtin skill uses `description: |` — must not collapse to "|"
  const own = scanSkillDir(path.join(__dirname, '..', '..', 'skills', 'marketplace-skill-installer'));
  assert.match(own.description, /技能市场/);
});

test('T47a vendored catalog: Apache skills present and digests match, restricted ones view-only', () => {
  const cat = loadBuiltin(CATALOG);
  assert.ok(cat, 'index.json loads');
  assert.strictEqual(cat.id, 'builtin:claude-skills');
  assert.match(cat.metadata.commit, /^[0-9a-f]{40}$/);
  const installable = cat.plugins.filter((p) => p.installable);
  assert.ok(installable.length >= 12, 'most Anthropic example skills are vendored');
  for (const p of installable) {
    assert.strictEqual(p.license, 'Apache-2.0', p.name);
    const dir = path.join(CATALOG, p.source.slice('builtin:'.length));
    const s = scanSkillDir(dir);
    assert.strictEqual(s.name, p.name, 'SKILL.md name matches index');
    assert.ok(s.description.length > 20, p.name + ' description parsed');
    assert.strictEqual(treeHash(dir), p.tree_sha256, p.name + ' tree digest');
    assert.ok(p.display_name && p.description_zh, p.name + ' has zh card metadata');
  }
  for (const n of ['docx', 'pdf', 'pptx', 'xlsx']) {
    const p = cat.plugins.find((x) => x.name === n);
    assert.ok(p, n + ' listed');
    assert.strictEqual(p.installable, false);
    assert.strictEqual(p.license, 'proprietary');
    assert.ok(!p.source, 'restricted skill has no payload source');
    assert.ok(!fs.existsSync(path.join(CATALOG, 'skills', n)), n + ' is not vendored');
  }
});

function tempMarket(catalogDir) {
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t47a-user-'));
  return { user, m: new Market({ sources: [], builtin: [catalogDir], skillsUser: user, installSkill }) };
}

test('T47a builtin install copies the skill; restricted and tampered entries are refused', async () => {
  const { user, m } = tempMarket(CATALOG);
  const hits = await m.search(['mcp']);
  assert.ok(hits.some((h) => h.name === 'mcp-builder' && h.market === 'claude-skills'));
  assert.ok((await m.search(['技能创建器'])).some((h) => h.name === 'skill-creator'), 'zh display name searchable');
  const r = await m.install('mcp-builder');
  assert.strictEqual(r.status, 'installed', JSON.stringify(r));
  assert.ok(fs.existsSync(path.join(user, 'mcp-builder', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(user, 'mcp-builder', 'LICENSE.txt')), 'license travels with the skill');
  assert.strictEqual((await m.install('mcp-builder')).status, 'already_installed');
  const pdf = await m.install('pdf');
  assert.strictEqual(pdf.status, 'refused');
  assert.match(pdf.reason, /许可/);

  // tamper: copy the catalog, flip one byte in a vendored file
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t47a-cat-'));
  fs.cpSync(CATALOG, copy, { recursive: true });
  fs.appendFileSync(path.join(copy, 'skills', 'theme-factory', 'SKILL.md'), '\nINJECTED');
  const t = tempMarket(copy);
  const bad = await t.m.install('theme-factory');
  assert.strictEqual(bad.status, 'refused');
  assert.match(bad.reason, /hash_mismatch/);
  assert.ok(!fs.existsSync(path.join(t.user, 'theme-factory')));
});

test('T47a a remote entry cannot claim a builtin: source', async () => {
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t47a-remote-'));
  const m = new Market({ sources: [], builtin: [], skillsUser: user, installSkill });
  m.cache.set('https://evil.example/index.json', [{ name: 'sneaky', source: 'builtin:skills/skill-creator' }]);
  const r = await m.install('sneaky');
  assert.strictEqual(r.status, 'refused');
  assert.match(r.reason, /builtin catalog/);
});

test('T47a market.builtin off → no builtin catalog', async () => {
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t47a-off-'));
  const m = new Market({ sources: [], builtin: [], skillsUser: user, installSkill });
  assert.strictEqual(m.list().length, 0);
  assert.deepStrictEqual(m.status().builtin, []);
});
