'use strict';
// Cloud skill marketplace (F25). Index + install semantics copied from
// WorkBuddy evidence (design/25-cloud-market.md): index.json mirrors
// marketplace.json structure; search takes 1-5 keywords; install returns
// installed / already_installed / refused per name; installed skills are
// never upgraded.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FETCH_TIMEOUT_MS = 60000;

function keywordsMatch(keywords, plugin) {
  const hay = [plugin.name, plugin.display_name, plugin.description, plugin.description_zh]
    .filter(Boolean).join(' ').toLowerCase();
  return keywords.length > 0 && keywords.length <= 5 && keywords.every((k) => hay.includes(String(k).toLowerCase()));
}

class Market {
  /**
   * @param opts {sources: string[], skillsUser, installSkill: fn, unzip: fn,
   *              fetchImpl?, allowInsecure?: boolean, log?,
   *              builtin?: string[]  — dirs holding a vendored index.json (F53)}
   */
  constructor(opts) {
    this.sources = (opts.sources || []).map(String).filter(Boolean);
    this.builtin = (opts.builtin || []).map(loadBuiltin).filter(Boolean);
    this.skillsUser = opts.skillsUser;
    this.installSkill = opts.installSkill; // (zipPath, dest, unzip) => skill
    this.unzip = opts.unzip;
    this.fetchImpl = opts.fetchImpl || ((u, o) => fetch(u, o));
    this.allowInsecure = !!opts.allowInsecure;
    this.log = opts.log || (() => {});
    this.lastIndexFetch = null;
    this.cache = new Map(); // source -> plugins[]
  }

  checkUrl(url) {
    let u;
    try { u = new URL(url); } catch (_) { return { ok: false, reason: 'bad url' }; }
    if (u.protocol === 'https:') return { ok: true, url };
    if (u.protocol === 'http:') {
      if (this.allowInsecure) return { ok: true, url };
      return { ok: false, reason: 'http refused (market.allowInsecure=false)' };
    }
    return { ok: false, reason: 'unsupported protocol: ' + u.protocol };
  }

  async refresh() {
    this.cache.clear();
    for (const src of this.sources) {
      const chk = this.checkUrl(src);
      if (!chk.ok) { this.log('market', 'source skipped: ' + chk.reason); continue; }
      try {
        const res = await this.fetchImpl(src, { timeout: FETCH_TIMEOUT_MS });
        if (!res.ok) throw new Error('http ' + res.status);
        const json = JSON.parse(String(await res.text()));
        this.cache.set(src, Array.isArray(json.plugins) ? json.plugins : []);
      } catch (e) {
        this.log('market', 'source failed: ' + src + ' — ' + e.message);
      }
    }
    this.lastIndexFetch = new Date().toISOString();
    return this.list();
  }

  list() {
    const installed = this.installedNames();
    const out = [];
    const push = (p, from, market) => out.push({
      name: p.name, display_name: p.display_name || p.name, description: p.description || '',
      description_zh: p.description_zh || '', version: p.version || '', category: p.category || 'skill',
      group: p.group || '', author: p.author || '', license: p.license || '', homepage: p.homepage || '',
      installable: p.installable !== false, reason: p.reason || '',
      source: p.source, sha256: p.sha256,
      from, market, installed: installed.has(p.name),
    });
    // builtin catalogs first (offline, always present), then remote sources
    for (const b of this.builtin) for (const p of b.plugins) push(p, b.id, b.name);
    for (const [src, plugins] of this.cache) for (const p of plugins) push(p, src, src);
    return out;
  }

  catalogs() {
    return this.builtin.map((b) => ({ id: b.id, name: b.name, display_name: b.display_name,
      description: b.description, owner: b.owner, metadata: b.metadata, plugins: b.plugins.length }));
  }

  async search(keywords) {
    const ks = Array.isArray(keywords) ? keywords : String(keywords || '').split(/\s+/).filter(Boolean);
    if (!this.cache.size && this.sources.length) await this.refresh();
    return this.list().filter((p) => keywordsMatch(ks, p));
  }

  installedNames() {
    const names = new Set();
    try {
      for (const dir of fs.readdirSync(this.skillsUser, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        try {
          const head = fs.readFileSync(path.join(this.skillsUser, dir.name, 'SKILL.md'), 'utf8').slice(0, 400);
          const m = /^name:\s*(.+)$/m.exec(head);
          if (m) names.add(m[1].trim());
        } catch (_) {}
      }
    } catch (_) {}
    return names;
  }

  /** @returns {status:'installed'|'already_installed'|'refused', reason?} */
  async install(name) {
    if (!this.cache.size && this.sources.length) await this.refresh();
    const hits = this.list().filter((p) => p.name === name);
    if (!hits.length) return { status: 'refused', reason: 'not found in market (search first)' };
    if (this.installedNames().has(name)) return { status: 'already_installed', reason: 'installed skills are not upgraded' };
    const plugin = hits[0];
    if (!plugin.installable) return { status: 'refused', reason: plugin.reason || 'not installable' };
    if (String(plugin.source || '').startsWith('builtin:')) return this.installBuiltin(plugin);
    if (!plugin.source) return { status: 'refused', reason: 'plugin has no source url' };
    const chk = this.checkUrl(plugin.source);
    if (!chk.ok) return { status: 'refused', reason: chk.reason };
    if (!plugin.sha256) return { status: 'refused', reason: 'market entry missing sha256 (integrity required)' };
    let zipPath;
    try {
      const res = await this.fetchImpl(plugin.source, { timeout: FETCH_TIMEOUT_MS });
      if (!res.ok) throw new Error('download http ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const sum = crypto.createHash('sha256').update(buf).digest('hex');
      if (sum !== String(plugin.sha256).toLowerCase()) return { status: 'refused', reason: 'hash_mismatch (' + sum.slice(0, 12) + ')' };
      zipPath = path.join(this.skillsUser, '.' + name.replace(/[^\w.-]/g, '_') + '.zip');
      fs.writeFileSync(zipPath, buf);
      await this.installSkill(zipPath, this.skillsUser, this.unzip);
      try { fs.rmSync(zipPath, { force: true }); } catch (_) {}
      this.log('market', 'installed skill: ' + name);
      return { status: 'installed', name, version: plugin.version };
    } catch (e) {
      if (zipPath) { try { fs.rmSync(zipPath, { force: true }); } catch (_) {} }
      return { status: 'refused', reason: String(e.message || e) };
    }
  }

  // F53: vendored skill → copy from the catalog dir after re-checking the
  // tree digest recorded at vendoring time (catches local tampering)
  async installBuiltin(plugin) {
    const cat = this.builtin.find((b) => b.id === plugin.from);
    // a remote index cannot point into the local catalog
    if (!cat) return { status: 'refused', reason: 'builtin: source only valid in a builtin catalog' };
    const rel = plugin.source.slice('builtin:'.length);
    const dir = path.resolve(cat.dir, rel);
    if (!dir.startsWith(path.resolve(cat.dir) + path.sep)) return { status: 'refused', reason: 'builtin source escapes catalog' };
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return { status: 'refused', reason: 'builtin payload missing: ' + rel };
    const entry = cat.plugins.find((p) => p.name === plugin.name);
    if (entry.tree_sha256 && treeHash(dir) !== entry.tree_sha256) return { status: 'refused', reason: 'hash_mismatch (builtin tree)' };
    try {
      await this.installSkill(dir, this.skillsUser);
      this.log('market', 'installed builtin skill: ' + plugin.name);
      return { status: 'installed', name: plugin.name, version: plugin.version };
    } catch (e) {
      return { status: 'refused', reason: String(e.message || e) };
    }
  }

  async installMany(names) {
    const results = [];
    for (const n of names || []) results.push({ name: n, ...(await this.install(n)) });
    return results;
  }

  status() {
    return { sources: this.sources, allowInsecure: this.allowInsecure, lastIndexFetch: this.lastIndexFetch,
      plugins: [...this.cache.values()].reduce((a, b) => a + b.length, 0),
      builtin: this.catalogs().map((c) => ({ id: c.id, plugins: c.plugins })) };
  }
}

/** Load a vendored catalog (index.json next to its skills/). Bad = skipped. */
function loadBuiltin(dir) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    return { id: 'builtin:' + (json.name || path.basename(dir)), dir, name: json.name, display_name: json.display_name || json.name,
      description: json.description || '', owner: json.owner || null, metadata: json.metadata || {},
      plugins: Array.isArray(json.plugins) ? json.plugins : [] };
  } catch (_) { return null; }
}

/** Same digest as scripts/vendor-claude-skills.mjs: sorted relpath\0bytes\0. */
function treeHash(dir) {
  const h = crypto.createHash('sha256');
  const files = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else files.push(r);
    }
  })(dir, '');
  for (const f of files) h.update(f + '\0').update(fs.readFileSync(path.join(dir, f))).update('\0');
  return h.digest('hex');
}

module.exports = { Market, keywordsMatch, treeHash, loadBuiltin };
