'use strict';
// F56 open-source expert catalog: a vendored directory of persona markdown
// files (market/agency-experts, upstream agency-agents @ MIT). Experts are
// PROMPTS, not skills and not running agents: importing creates a preset the
// user binds to a session (F41 semantics). Files are read verbatim after a
// sha256 check so local tampering is refused.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE_PREFIX = 'builtin:agency-experts/';

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }

function createExpertCatalog({ dir, presets, log = () => {} }) {
  const index = loadIndex(dir);

  function loadIndex(d) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8'));
      return { dir, ...json, experts: Array.isArray(json.experts) ? json.experts : [] };
    } catch (_) { return { dir, experts: [] }; }
  }

  function enabled() { return index.experts.length > 0; }

  function installedBySource() {
    const map = new Map(); // expertId -> preset
    for (const p of presets.list()) {
      const src = p.meta && p.meta.source;
      if (typeof src === 'string' && src.startsWith(SOURCE_PREFIX)) map.set(src.slice(SOURCE_PREFIX.length), p);
    }
    return map;
  }

  function list() {
    const installed = installedBySource();
    return {
      catalog: enabled() ? { id: index.name, display_name: index.display_name, description: index.description,
        owner: index.owner, metadata: index.metadata } : null,
      experts: index.experts.map((e) => ({ id: e.id, name: e.name, display_name: e.display_name,
        description: e.description, description_zh: e.description_zh, division: e.division,
        division_zh: e.division_zh, emoji: e.emoji, author: e.author, license: e.license,
        homepage: e.homepage, installed: installed.has(e.id) })),
    };
  }

  /** verbatim persona body after frontmatter; sha256 must match the index */
  function read(id) {
    const entry = index.experts.find((e) => e.id === id);
    if (!entry) fail('not_found', 'unknown expert: ' + id);
    const file = path.join(index.dir, 'experts', id + '.md');
    // resolve + containment (paranoia; ids are index-controlled, not user input paths)
    if (!file.startsWith(path.resolve(index.dir) + path.sep)) fail('invalid_id', 'bad expert id');
    let raw;
    try { raw = fs.readFileSync(file); } catch (_) { fail('not_found', 'expert file missing: ' + id); }
    if (crypto.createHash('sha256').update(raw).digest('hex') !== String(entry.sha256).toLowerCase()) {
      fail('hash_mismatch', 'expert file tampered: ' + id);
    }
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw.toString('utf8'));
    if (!m) fail('invalid_file', 'expert file has no frontmatter: ' + id);
    return { id, name: entry.name, display_name: entry.display_name, description: entry.description,
      description_zh: entry.description_zh, division: entry.division, division_zh: entry.division_zh,
      prompt: m[2].trim(), license: entry.license, homepage: entry.homepage,
      upstream: (index.metadata && index.metadata.upstream) || null,
      commit: (index.metadata && index.metadata.commit) || null };
  }

  /** @returns {status:'installed'|'already_installed'|'refused', presetId?} */
  function importExpert(id) {
    let expert;
    try { expert = read(id); }
    catch (e) { return { status: 'refused', reason: e.message }; }
    const existing = installedBySource().get(id);
    if (existing) return { status: 'already_installed', presetId: existing.id, name: existing.name };
    const preset = presets.create({
      name: expert.name,
      description: expert.description_zh || expert.description,
      prompt: expert.prompt,
      meta: {
        source: SOURCE_PREFIX + id, expertId: id, upstream: expert.upstream,
        homepage: expert.homepage, license: expert.license, upstreamCommit: expert.commit,
        importedAt: new Date().toISOString(),
      },
    });
    log('experts', 'imported expert: ' + id + ' → preset ' + preset.id);
    return { status: 'installed', presetId: preset.id, name: preset.name };
  }

  return { list, read, importExpert, enabled };
}

module.exports = { createExpertCatalog, EXPERT_SOURCE_PREFIX: SOURCE_PREFIX };
