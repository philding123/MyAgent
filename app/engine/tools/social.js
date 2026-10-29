'use strict';
// Social/feed pull tools (F57, design/40). A SKILL.md cannot fetch anything by
// itself — pulling social content needs a tool. Platform map (probed from this
// machine, see design/40 §观察):
//   hackernews  — hn.algolia.com public API, keyless, direct-reachable
//   rss         — any RSS/Atom feed URL; domestic social (weibo/zhihu/bilibili…)
//                 has no open read API and scraping breaks their ToS, so the
//                 supported route is a SELF-HOSTED RSSHub instance exposing
//                 standard feeds (localhost by default, no third-party relay).
// X/Reddit/Bluesky/YouTube keyless endpoints exist but are NOT direct-reachable
// from this network and Node fetch ignores system proxies — those stay on the
// connector (MCP, user-provided keys) route. Read-only, capped, errors as values.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MyAgent/0.1 (personal)';
const FETCH_TIMEOUT_MS = 15000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 30;
const MAX_ITEM_CHARS = 400;
const MAX_TOTAL_CHARS = 8000;

async function httpGet(url, { fetchImpl } = {}) {
  const f = fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await f(url, {
      headers: { 'user-agent': UA, accept: 'application/json, application/xml, application/rss+xml, text/xml, */*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bytes: buf.subarray(0, MAX_FEED_BYTES) };
  } finally { clearTimeout(timer); }
}

function decodeEntities(s) {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ldquo: '“', rdquo: '”', hellip: '…', mdash: '—' };
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ''; } })
    .replace(/&([a-z]+);/gi, (m, n) => (named[String(n).toLowerCase()] !== undefined ? named[String(n).toLowerCase()] : m));
}

function stripTags(html) {
  // decode entities first so entity-encoded tags (&lt;b&gt;) get stripped too
  return decodeEntities(String(html)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// tag content with CDATA/plain-text; < 5 named entities stay for decodeEntities
function tagValue(block, tag) {
  const m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i').exec(block);
  if (!m) return '';
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/i.exec(m[1].trim());
  return (cdata ? cdata[1] : m[1]).trim();
}

// Compact RSS2/Atom parser — good enough for well-formed feeds; export for tests.
function parseFeed(xml) {
  const text = String(xml);
  const items = [];
  const blocks = [];
  for (const m of text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) blocks.push(m[1]);
  if (!blocks.length) for (const m of text.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) blocks.push(m[1]);
  if (!blocks.length) return null; // not a feed we understand
  for (const b of blocks) {
    const title = decodeEntities(tagValue(b, 'title'));
    // RSS <link>text</link> vs Atom <link href="…"/> (prefer rel=alternate)
    let link = tagValue(b, 'link');
    if (!link) {
      let best = '';
      for (const lm of b.matchAll(/<link\b([^>]*)>/gi)) {
        const attrs = lm[1];
        const href = /href="([^"]+)"/i.exec(attrs);
        if (!href) continue;
        if (/rel="alternate"/i.test(attrs)) { best = href[1]; break; }
        if (!best) best = href[1];
      }
      link = best;
    }
    const date = tagValue(b, 'pubDate') || tagValue(b, 'published') || tagValue(b, 'updated') || tagValue(b, 'dc:date');
    const desc = stripTags(tagValue(b, 'description') || tagValue(b, 'summary') || tagValue(b, 'content:encoded') || tagValue(b, 'content'));
    items.push({ title, url: decodeEntities(link), published: date, text: desc });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

function hnItem(hit) {
  const text = stripTags(String(hit.story_text || hit.comment_text || hit._highlightResult?.title?.value || ''));
  return {
    title: String(hit.title || hit.story_title || '(untitled)').slice(0, 160),
    url: hit.url || ('https://news.ycombinator.com/item?id=' + hit.objectID),
    author: hit.author || '',
    points: typeof hit.points === 'number' ? hit.points : null,
    comments: typeof hit.num_comments === 'number' ? hit.num_comments : null,
    published: hit.created_at ? String(hit.created_at).slice(0, 10) : '',
    text: text.slice(0, MAX_ITEM_CHARS),
  };
}

function capItems(items) {
  let total = 0;
  const out = [];
  for (const it of items) {
    const keep = Math.max(0, Math.min(MAX_ITEM_CHARS, MAX_TOTAL_CHARS - total));
    it.text = String(it.text || '').slice(0, keep);
    total += it.text.length;
    out.push(it);
    if (total >= MAX_TOTAL_CHARS) break;
  }
  return out;
}

function makeSocialTools({ fetchImpl } = {}) {
  return {
    social_fetch: {
      kind: 'read',
      description: 'Pull current social/community content. Platforms: hackernews (search posts+comments via the public Algolia API), rss (any RSS/Atom feed url — e.g. a self-hosted RSSHub route like http://localhost:1200/weibo/search/hot for weibo/zhihu/bilibili). X/Reddit keyless endpoints are not direct-reachable; use connectors for those. Args: {platform:"hackernews"|"rss", query?, url?, limit?}',
      schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['hackernews', 'rss'] },
          query: { type: 'string' },
          url: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['platform'],
      },
      run: async (args) => {
        const limit = Math.min(Math.max(args.limit || 10, 1), MAX_ITEMS);
        try {
          if (args.platform === 'hackernews') {
            const q = String(args.query || '').trim();
            const url = q
              ? 'https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(q) + '&tags=story&hitsPerPage=' + limit
              : 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=' + limit;
            const r = await httpGet(url, { fetchImpl });
            if (r.status !== 200) return { ok: false, summary: 'social_fetch HTTP ' + r.status + ' from hn.algolia.com' };
            const json = JSON.parse(r.bytes.toString('utf8'));
            const items = capItems((json.hits || []).slice(0, limit).map(hnItem));
            return { ok: true, summary: 'hackernews ' + (q ? '"' + q + '"' : 'front page') + ': ' + items.length + ' items',
              data: { platform: 'hackernews', items } };
          }
          if (args.platform === 'rss') {
            const url = String(args.url || '');
            if (!/^https?:\/\//i.test(url)) return { ok: false, summary: 'social_fetch rss needs an http(s) feed url' };
            const r = await httpGet(url, { fetchImpl });
            if (r.status !== 200) return { ok: false, summary: 'social_fetch HTTP ' + r.status + ' from ' + url.slice(0, 120) };
            const items = parseFeed(r.bytes.toString('utf8'));
            if (!items) return { ok: false, summary: 'not an RSS/Atom feed (no <item>/<entry> found)' };
            const cut = capItems(items.slice(0, limit));
            return { ok: true, summary: 'rss ' + url + ': ' + cut.length + ' items',
              data: { platform: 'rss', url, items: cut } };
          }
          return { ok: false, summary: 'unknown platform "' + args.platform + '" (hackernews|rss)' };
        } catch (e) {
          return { ok: false, summary: 'social_fetch failed: ' + String(e && e.message || e).slice(0, 160) };
        }
      },
    },
  };
}

module.exports = { makeSocialTools, parseFeed, decodeEntities, stripTags };
