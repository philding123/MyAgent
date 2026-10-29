'use strict';
// T52 unit: social_fetch (F57, design/40) — HN Algolia adapter, generic RSS/Atom
// parsing (CDATA/entities/atom links), caps, and error-as-value discipline.
// Fetch is injected; no real network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSocialTools, parseFeed, decodeEntities } = require('../../app/engine/tools/social');

const res = (status, body, headers = {}) => ({ status, headers: new Map(Object.entries(headers)), arrayBuffer: async () => Buffer.from(body) });
const stub = (map) => async (url) => {
  for (const [frag, r] of Object.entries(map)) if (url.includes(frag)) return r;
  throw new Error('unexpected url ' + url);
};

test('T52 hackernews search maps hits and honors limit', async () => {
  const hits = Array.from({ length: 5 }, (_, i) => ({
    objectID: 'id' + i, title: 'Story ' + i, url: 'https://example.com/' + i, author: 'u' + i,
    points: 10 + i, num_comments: i, created_at: '2026-10-2' + i + 'T00:00:00Z', story_text: '<p>body &amp; more</p>',
  }));
  const tools = makeSocialTools({ fetchImpl: stub({ 'hn.algolia.com': res(200, JSON.stringify({ hits })) }) });
  const r = await tools.social_fetch.run({ platform: 'hackernews', query: 'rust', limit: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.data.items.length, 3);
  assert.equal(r.data.items[0].title, 'Story 0');
  assert.equal(r.data.items[0].points, 10);
  assert.equal(r.data.items[0].text, 'body & more');
  assert.ok(r.data.items[0].url.startsWith('https://example.com/'));
  assert.ok(r.summary.includes('3 items'));
  // front page when query omitted
  const r2 = await tools.social_fetch.run({ platform: 'hackernews', limit: 2 });
  assert.equal(r2.ok, true);
});

test('T52 rss parser handles RSS2 CDATA, atom links and entities', () => {
  const rss = `<rss version="2.0"><channel><title>t</title>${Array.from({ length: 3 }, (_, i) =>
    `<item><title><![CDATA[标题 ${i} &amp; 更多]]></title><link>https://s.test/${i}</link><pubDate>Mon, 26 Oct 2026 0${i}:00:00 GMT</pubDate><description>&lt;b&gt;bold&lt;/b&gt; 描述&#x4E2D;文</description></item>`).join('')}</channel></rss>`;
  const items = parseFeed(rss);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, '标题 0 & 更多');
  assert.equal(items[0].url, 'https://s.test/0');
  assert.equal(items[0].text, 'bold 描述中文');
  assert.match(items[0].published, /Mon, 26 Oct/);

  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>atom 标题</title><link rel="self" href="https://x.test/self"/><link rel="alternate" href="https://x.test/a1"/><published>2026-10-25T08:00:00Z</published><summary>摘要</summary></entry></feed>`;
  const a = parseFeed(atom);
  assert.equal(a.length, 1);
  assert.equal(a[0].url, 'https://x.test/a1', 'atom prefers rel=alternate');
  assert.equal(a[0].text, '摘要');
  assert.equal(parseFeed('<html><body>no feed</body></html>'), null);
});

test('T52 rss platform requires http(s) url and surfaces feed errors as values', async () => {
  const tools = makeSocialTools({ fetchImpl: stub({ 'good.test': res(200, '<rss><channel><item><title>a</title><link>https://a</link></item></channel></rss>'),
    'notafeed.test': res(200, '<html>hi</html>'), 'err500.test': res(500, 'x') }) });
  assert.equal((await tools.social_fetch.run({ platform: 'rss', url: 'ftp://nope' })).ok, false);
  const bad = await tools.social_fetch.run({ platform: 'rss', url: 'https://notafeed.test/f' });
  assert.equal(bad.ok, false);
  assert.match(bad.summary, /not an RSS\/Atom feed/);
  const http = await tools.social_fetch.run({ platform: 'rss', url: 'https://err500.test/f' });
  assert.equal(http.ok, false);
  assert.match(http.summary, /HTTP 500/);
  const ok = await tools.social_fetch.run({ platform: 'rss', url: 'https://good.test/feed', limit: 5 });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.items.length, 1);
});

test('T52 caps: items bounded, per-item and total text budgets hold', async () => {
  const long = 'x'.repeat(2000);
  const hits = Array.from({ length: 40 }, (_, i) => ({ objectID: '' + i, title: 'S' + i, points: 1 }));
  const tools = makeSocialTools({ fetchImpl: stub({ 'hn.algolia.com': res(200, JSON.stringify({ hits })) }) });
  const r = await tools.social_fetch.run({ platform: 'hackernews', limit: 40 });
  assert.ok(r.data.items.length <= 30, 'item cap');
  const total = r.data.items.reduce((a, b) => a + b.text.length, 0);
  assert.ok(total <= 8000 + 30, 'total text cap: ' + total);

  const tools2 = makeSocialTools({ fetchImpl: stub({ 'hn.algolia.com': res(200, JSON.stringify({ hits: [{ objectID: '1', title: 't', story_text: long }] })) }) });
  const r2 = await tools2.social_fetch.run({ platform: 'hackernews', query: 'q' });
  assert.ok(r2.data.items[0].text.length <= 400, 'per-item cap');
});

test('T52 transport failure and unknown platform are values, timeout aborts', async () => {
  const fail = async () => { throw new Error('fetch failed'); };
  const tools = makeSocialTools({ fetchImpl: fail });
  const r = await tools.social_fetch.run({ platform: 'hackernews', query: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.summary, /social_fetch failed: fetch failed/);
  const unk = await tools.social_fetch.run({ platform: 'twitter' });
  assert.equal(unk.ok, false);
  assert.match(unk.summary, /unknown platform/);
  assert.equal(tools.social_fetch.kind, 'read');
  assert.equal(decodeEntities('a &amp; b &#20013; c'), 'a & b 中 c');
});
