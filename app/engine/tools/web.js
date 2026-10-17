'use strict';
// Web retrieval tools (F46, task-parity P0-2). wb's agent collects pages
// server-side, so local network interference never reaches its research loop;
// MyAgent's only retrieval was the client browser (playwright), which lost
// 4/17 calls to GitHub-family hosts in the REA benchmark (artifacts/
// task-parity/report.md). web_search/web_fetch give the model fast structured
// retrieval without a browser launch — plain Node fetch, UA + timeout + size
// caps, errors as values. Direct connection; proxy rides on the process env
// once configured (no third-party relay by default, 无遥测外发红线).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 30000;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHARS = 20000;

async function httpGet(url, { fetchImpl } = {}) {
  const f = fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await f(url, {
      headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      contentType: (res.headers && res.headers.get && res.headers.get('content-type')) || '',
      bytes: buf.subarray(0, MAX_BYTES),
      truncated: buf.length > MAX_BYTES,
    };
  } finally { clearTimeout(timer); }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// cn.bing.com SERP parser — tolerant split on b_algo blocks; markup varies,
// so anchor/p extraction is best-effort per block. Exported for tests.
function parseBingResults(html) {
  const out = [];
  for (const block of String(html).split('b_algo').slice(1)) {
    const a = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!a) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    out.push({
      url: decodeEntities(a[1]),
      title: htmlToText(a[2]).slice(0, 200),
      snippet: p ? htmlToText(p[1]).slice(0, 300) : '',
    });
    if (out.length >= 20) break;
  }
  return out;
}

function makeWebTools({ fetchImpl } = {}) {
  const tools = {
    web_search: {
      kind: 'read',
      description: 'Web search via cn.bing.com. Returns {title,url,snippet} list. Args: {query, count?}',
      schema: {
        type: 'object',
        properties: { query: { type: 'string' }, count: { type: 'number' } },
        required: ['query'],
      },
      run: async (args) => {
        const n = Math.min(Math.max(args.count || 10, 1), 20);
        const url = 'https://cn.bing.com/search?q=' + encodeURIComponent(args.query) + '&count=' + n + '&mkt=zh-CN';
        try {
          const r = await httpGet(url, { fetchImpl });
          if (r.status !== 200) return { ok: false, summary: 'web_search HTTP ' + r.status };
          const results = parseBingResults(r.bytes.toString('utf8')).slice(0, n);
          return { ok: true, summary: results.length + ' results for "' + args.query + '"',
            data: { results } };
        } catch (e) {
          return { ok: false, summary: 'web_search failed: ' + String(e && e.message || e).slice(0, 160) };
        }
      },
    },
    web_fetch: {
      kind: 'read',
      description: 'Fetch one http(s) URL and return readable text (html stripped to text). Args: {url, max_chars?}',
      schema: {
        type: 'object',
        properties: { url: { type: 'string' }, max_chars: { type: 'number' } },
        required: ['url'],
      },
      run: async (args) => {
        if (!args.url || !/^https?:\/\//i.test(args.url)) return { ok: false, summary: 'web_fetch needs http(s) url' };
        try {
          const r = await httpGet(args.url, { fetchImpl });
          const ctype = r.contentType.toLowerCase();
          const isText = /text\/|json|xml|javascript/.test(ctype) || !ctype;
          const max = Math.min(Math.max(args.max_chars || DEFAULT_CHARS, 200), 100000);
          if (!isText) return { ok: false, summary: 'web_fetch: non-text content-type ' + r.contentType };
          const raw = r.bytes.toString('utf8');
          const text = /html/.test(ctype) ? htmlToText(raw) : raw;
          return { ok: true, summary: 'fetched ' + args.url + ' (' + text.length + ' chars' + (r.truncated ? ', body truncated' : '') + ')',
            data: { content: text.slice(0, max), status: r.status, contentType: r.contentType } };
        } catch (e) {
          return { ok: false, summary: 'web_fetch failed: ' + String(e && e.message || e).slice(0, 160) };
        }
      },
    },
  };
  return tools;
}

module.exports = { makeWebTools, parseBingResults, htmlToText };
