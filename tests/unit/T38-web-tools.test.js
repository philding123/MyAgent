'use strict';
// T38: web retrieval tools (F46) — bing SERP parsing, html→text, injected
// fetch for search, real localhost fetch for web_fetch, errors as values.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { makeWebTools, parseBingResults, htmlToText } = require('../../app/engine/tools/web');

const SERP = `<html><body>
<ol><li class="b_algo"><h2><a href="https://rea.run/zh/">REA（Reverse Engineer Anything）社区指南</a></h2>
<div><p>REA 是把 Hopper/Ghidra/IDA 封装成 MCP 服务的开源框架 &amp; Agent Skill。</p></div></li>
<li class="b_algo"><h2><a href="https://github.com/morluto/rea">morluto/rea</a></h2>
<p>Reverse Engineer Anything skill repository</p></li>
</ol></body></html>`;

test('T38 bing SERP parser extracts title/url/snippet', () => {
  const r = parseBingResults(SERP);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].url, 'https://rea.run/zh/');
  assert.match(r[0].title, /REA（Reverse Engineer Anything）社区指南/);
  assert.match(r[0].snippet, /MCP 服务的开源框架 & Agent Skill/);
  assert.strictEqual(r[1].url, 'https://github.com/morluto/rea');
});

test('T38 htmlToText strips script/style and decodes entities', () => {
  const t = htmlToText('<style>p{}</style><script>evil()</script><b>a&nbsp;&amp;&nbsp;b</b>');
  assert.strictEqual(t, 'a & b');
});

test('T38 web_search uses cn.bing.com with encoded query (injected fetch)', async () => {
  let seenUrl = '';
  const tools = makeWebTools({ fetchImpl: async (url) => {
    seenUrl = url;
    return { status: 200, headers: { get: () => 'text/html' }, arrayBuffer: async () => Buffer.from(SERP) };
  } });
  const r = await tools.web_search.run({ query: 'REA skill', count: 5 });
  assert.ok(r.ok, r.summary);
  assert.ok(seenUrl.startsWith('https://cn.bing.com/search?q=REA%20skill'));
  assert.strictEqual(r.data.results.length, 2);
});

test('T38 web_search HTTP error and transport failure are values', async () => {
  const tools = makeWebTools({ fetchImpl: async () => ({ status: 503, headers: { get: () => '' }, arrayBuffer: async () => Buffer.from('') }) });
  const bad = await tools.web_search.run({ query: 'x' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.summary, /503/);
  const dead = makeWebTools({ fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  const err = await dead.web_search.run({ query: 'x' });
  assert.strictEqual(err.ok, false);
  assert.match(err.summary, /ECONNRESET/);
});

test('T38 web_fetch strips html over real localhost and caps chars', async () => {
  const server = http.createServer((_q, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>t</title><script>var x=1;</script></head><body><p>' + 'hello '.repeat(5000) + '</p></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const tools = makeWebTools();
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    const r = await tools.web_fetch.run({ url, max_chars: 500 });
    assert.ok(r.ok, r.summary);
    assert.ok(!r.data.content.includes('<script>'), 'tags and script stripped');
    assert.match(r.data.content, /^t hello/, 'title then body text kept (tags → spaces)');
    assert.ok(r.data.content.length <= 500, 'max_chars respected');
    const bad = await tools.web_fetch.run({ url: 'ftp://x' });
    assert.strictEqual(bad.ok, false);
    const missing = await tools.web_fetch.run({ url: 'http://127.0.0.1:1/' });
    assert.strictEqual(missing.ok, false);
  } finally { server.close(); }
});
