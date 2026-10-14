'use strict';
// T20a/T21a/T22a/T23a/T25a/T26a: pure logic for Phase-2/3/4 features.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { extractMermaidBlocks, pickPreviewKind, mimeForExt } = require('../../app/shared/preview-kind');
const { Updater, compareSemver } = require('../../app/main/updater');
const { ACTION_KINDS } = require('../../app/engine/tools/browser');
const { RingDedup } = require('../../app/daemon/im');
const { isValidToken, markdownToTelegramHtml, splitHtml, stripHtml } = require('../../app/daemon/im-channels/telegram');
const { keywordsMatch } = require('../../app/daemon/market');
const { Market } = require('../../app/daemon/market');
const { SyncTargetDirectory } = require('../../app/daemon/sync');
const { agentCard } = require('../../app/daemon/a2a');

// ---------- T20a: mermaid extraction + preview kinds ----------
test('T20a extractMermaidBlocks finds mermaid fences only', () => {
  const md = ['```mermaid', 'graph TD; A-->B;', '```', 'text', '```js', 'const x=1;', '```', '```mermaid', 'pie', '```'].join('\n');
  const blocks = extractMermaidBlocks(md);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0], 'graph TD; A-->B;');
  // unterminated fence ignored
  assert.strictEqual(extractMermaidBlocks('```mermaid\ngraph').length, 0);
});

test('T20a pickPreviewKind maps office/image/text families', () => {
  assert.strictEqual(pickPreviewKind('a.DOCX'), 'docx');
  assert.strictEqual(pickPreviewKind('report.pdf'), 'pdf');
  assert.strictEqual(pickPreviewKind('data.csv'), 'sheet');
  assert.strictEqual(pickPreviewKind('deck.pptx'), 'pptx');
  assert.strictEqual(pickPreviewKind('photo.PNG'), 'image');
  assert.strictEqual(pickPreviewKind('notes.md'), 'text');
  assert.strictEqual(pickPreviewKind('virus.exe'), 'unsupported');
  assert.strictEqual(pickPreviewKind('noext'), 'unsupported');
  assert.strictEqual(mimeForExt('x.pdf'), 'application/pdf');
});

// ---------- T21a: updater semver + sha256 verify + malformed manifest ----------
test('T21a compareSemver ordering', () => {
  assert.strictEqual(compareSemver('1.2.3', '1.2.3'), 0);
  assert.ok(compareSemver('1.10.0', '1.9.9') > 0);
  assert.ok(compareSemver('0.1.0', '0.2.0') < 0);
  assert.ok(compareSemver('2.0.0', '1.99.99') > 0);
});

test('T21a updater: malformed manifest -> error not throw', async () => {
  const u = new Updater({ manifestUrl: 'x', currentVersion: '0.1.0',
    fetchImpl: async () => ({ ok: true, text: async () => 'not json' }) });
  const r = await u.check();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(u.state.stage, 'error');
});

test('T21a updater: missing manifest fields rejected', async () => {
  const u = new Updater({ manifestUrl: 'x', currentVersion: '0.1.0',
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ version: '9.9.9' }) }) });
  const r = await u.check();
  assert.strictEqual(r.ok, false);
  assert.ok(/missing field/.test(r.reason));
});

test('T21a updater: sha256 mismatch deletes the artifact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't21a-'));
  const file = path.join(dir, 'update.zip');
  fs.writeFileSync(file, 'payload');
  const u = new Updater({ manifestUrl: 'x', currentVersion: '0.1.0', fetchImpl: async () => ({ ok: true, text: async () => '{}' }) });
  u.state.manifest = { version: '9.9.9', url: 'http://x/update.zip', sha256: 'deadbeef'.repeat(8) };
  const r = u.verify(file);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(u.state.stage, 'error');
  assert.ok(!fs.existsSync(file), 'artifact removed after mismatch');
});

test('T21a updater: apply refuses when nothing ready', () => {
  const u = new Updater({ manifestUrl: '', currentVersion: '0.1.0' });
  const r = u.apply({});
  assert.strictEqual(r.ok, false);
});

// ---------- T22a: browser action protocol ----------
test('T22a action kinds: read vs exec split is design-true', () => {
  assert.strictEqual(ACTION_KINDS.navigate, 'read');
  assert.strictEqual(ACTION_KINDS.content, 'read');
  assert.strictEqual(ACTION_KINDS.snapshot, 'read');
  assert.strictEqual(ACTION_KINDS.screenshot, 'read');
  assert.strictEqual(ACTION_KINDS.close, 'read');
  for (const a of ['click', 'fill', 'press', 'scroll']) assert.strictEqual(ACTION_KINDS[a], 'exec');
});

test('T22a foreign ref rejected before any browser launch', async () => {
  const { makeBrowserSession } = require('../../app/engine/tools/browser');
  let launched = false;
  const s = makeBrowserSession({ playwright: { chromium: { launch: async () => { launched = true; throw new Error('should not launch'); } } } });
  const r = await s.run({ action: 'click', ref: 'r999' }).catch((e) => ({ error: e }));
  assert.ok(r.error || r.ok === false, 'click with unknown ref fails');
  assert.strictEqual(launched, false, 'no browser was launched');
});

// ---------- T23a: dedup ring + telegram helpers ----------
test('T23a RingDedup keeps newest 500, drops duplicates', () => {
  const d = new RingDedup(3);
  assert.strictEqual(d.seen('a'), false);
  assert.strictEqual(d.seen('a'), true, 'duplicate detected');
  d.seen('b'); d.seen('c');
  assert.strictEqual(d.seen('d'), false);
  assert.strictEqual(d.seen('a'), false, 'oldest (a) was evicted');
  assert.strictEqual(d.size, 3);
  const big = new RingDedup();
  for (let i = 0; i < 500; i++) big.seen('m' + i);
  big.seen('m0x'); // push out m0
  assert.strictEqual(big.seen('m0'), false, 'm0 evicted at cap 500');
  assert.strictEqual(big.size, 500);
});

test('T23a telegram token validation', () => {
  assert.ok(isValidToken('123456:ABC-def_GHI'));
  assert.ok(!isValidToken('no-colon'));
  assert.ok(!isValidToken('abc:short'));
  assert.ok(!isValidToken(''));
});

test('T23a markdown -> telegram html covers headings/bold/code/links', () => {
  const html = markdownToTelegramHtml('# Title\n**bold** and `code` [x](https://a.b)\n- item');
  assert.ok(html.includes('<b>Title</b>'));
  assert.ok(html.includes('<b>bold</b>'));
  assert.ok(html.includes('<code>code</code>'));
  assert.ok(html.includes('<a href="https://a.b">x</a>'));
  assert.ok(html.includes('• item'));
});

test('T23a splitHtml chunks without cutting tags and stays under limit', () => {
  const html = '<b>' + 'x'.repeat(9500) + '</b><i>y</i>';
  const parts = splitHtml(html, 4000);
  assert.ok(parts.length >= 3);
  for (const p of parts) {
    assert.ok(p.length <= 4096 + 40, 'chunk near limit, got ' + p.length);
    const opens = (p.match(/<b>/g) || []).length;
    const closes = (p.match(/<\/b>/g) || []).length;
    assert.strictEqual(opens, closes, 'tags balanced in chunk');
  }
  assert.strictEqual(splitHtml('short', 4000).length, 1);
  assert.strictEqual(stripHtml('<b>a&amp;b</b>'), 'a&b');
});

// ---------- T25a: market keyword match + url policy ----------
test('T25a keywordsMatch requires all keywords (1-5)', () => {
  const p = { name: 'code-review', description: 'Review code diffs' };
  assert.ok(keywordsMatch(['code'], p));
  assert.ok(keywordsMatch(['code', 'review'], p));
  assert.ok(!keywordsMatch(['code', 'python'], p));
  assert.ok(!keywordsMatch([], p));
  assert.ok(!keywordsMatch(['a', 'b', 'c', 'd', 'e', 'f'], p));
});

test('T25a market refuses plain http unless allowInsecure', () => {
  const mk = (allow) => new Market({ sources: [], skillsUser: '.', installSkill: () => {}, allowInsecure: allow });
  assert.strictEqual(mk(false).checkUrl('http://x/index.json').ok, false);
  assert.ok(/allowInsecure/.test(mk(false).checkUrl('http://x/index.json').reason));
  assert.strictEqual(mk(true).checkUrl('http://127.0.0.1:1/index.json').ok, true);
  assert.strictEqual(mk(false).checkUrl('https://x/index.json').ok, true);
  assert.strictEqual(mk(false).checkUrl('ftp://x').ok, false);
});

// ---------- T26a: directory sync target ----------
test('T26a SyncTargetDirectory put/get/list roundtrip', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't26a-'));
  const t = new SyncTargetDirectory(root);
  await t.put('s1', JSON.stringify({ rev: 1 }));
  const raw = await t.get('s1');
  assert.strictEqual(JSON.parse(raw).rev, 1);
  assert.strictEqual(await t.get('missing'), null);
  await t.put('s2', '{}');
  const ids = await t.listIds();
  assert.ok(ids.includes('s1') && ids.includes('s2'));
});

// ---------- T28: agent card shape ----------
test('T28 agentCard has A2A-required fields', () => {
  const c = agentCard({ name: 'MyAgent', url: 'http://127.0.0.1:1' });
  assert.strictEqual(c.name, 'MyAgent');
  assert.ok(c.url);
  assert.strictEqual(c.capabilities.streaming, false);
  assert.ok(Array.isArray(c.defaultInputModes));
  assert.ok(c.skills.length >= 1);
});
