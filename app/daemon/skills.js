'use strict';
// Skill loader (F11). SKILL.md format identical to WorkBuddy builtin skills:
// YAML frontmatter with name/description/allowed-tools/disable (+ optional
// scripts/, references/). Progressive disclosure: only name+description enter
// the system prompt; the engine reads the full body via skill_read.

const fs = require('fs');
const path = require('path');

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {};
  let body = text;
  if (m) {
    body = text.slice(m[0].length);
    let lastKey = null;
    let block = null; // YAML block scalar in progress: {key, fold, lines}
    const endBlock = () => {
      if (!block) return;
      const lines = block.lines;
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      const indent = Math.min(...lines.filter(Boolean).map((l) => /^ */.exec(l)[0].length));
      const raw = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
      meta[block.key] = block.fold
        ? raw.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ').trim()
        : raw.join('\n').trim();
      block = null;
    };
    for (const line of m[1].split(/\r?\n/)) {
      if (block) {
        if (line === '' || /^\s/.test(line)) { block.lines.push(line.trimEnd()); continue; }
        endBlock();
      }
      const listItem = /^\s+-\s?(.*)$/.exec(line);
      if (listItem && lastKey) {
        if (!Array.isArray(meta[lastKey])) meta[lastKey] = [];
        meta[lastKey].push(listItem[1].trim());
        continue;
      }
      const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (!kv) continue;
      const [, k, raw] = kv;
      lastKey = k;
      if (raw === '') { meta[k] = raw; continue; }
      if (/^[|>][+-]?\s*$/.test(raw)) { block = { key: k, fold: raw[0] === '>', lines: [] }; continue; }
      if (/^"[\s\S]*"\s*$/.test(raw)) {
        try { meta[k] = JSON.parse(raw.trim()); } catch (_) { meta[k] = raw.trim().slice(1, -1); }
        continue;
      }
      if (/^'[\s\S]*'\s*$/.test(raw)) { meta[k] = raw.trim().slice(1, -1).replace(/''/g, "'"); continue; }
      if (raw.startsWith('[')) {
        try { meta[k] = JSON.parse(raw); } catch (_) { meta[k] = raw; }
      } else if (/^(true|false)$/i.test(raw)) meta[k] = /^true$/i.test(raw);
      else meta[k] = raw;
    }
    endBlock();
  }
  return { meta, body };
}

function scanSkillDir(dir) {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const { meta, body } = parseFrontmatter(text);
  const name = meta.name || path.basename(dir);
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) files.push(entry.name);
    else if (entry.isDirectory()) {
      try { for (const f of fs.readdirSync(path.join(dir, entry.name))) files.push(entry.name + '/' + f); } catch (_) {}
    }
  }
  return {
    name,
    description: meta.description || '',
    allowedTools: meta['allowed-tools'] || [],
    disable: meta.disable === true,
    dir,
    files,
    body,
    source: 'user',
  };
}

class SkillRegistry {
  /** @param dirs {string[]} builtin first, user dirs after */
  constructor(dirs) {
    this.dirs = dirs.filter(Boolean);
    this.overrides = {}; // name -> disable override from runtime toggle
  }
  scan() {
    const found = new Map();
    for (const root of this.dirs) {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const skill = scanSkillDir(path.join(root, e.name));
        if (skill) {
          skill.source = found.has(skill.name) ? 'user' : found.has('') ? 'user' : skill.source;
          if (!found.has(skill.name)) skill.source = root === this.dirs[0] ? 'builtin' : 'user';
          found.set(skill.name, skill);
        }
      }
    }
    const list = [...found.values()];
    for (const s of list) if (this.overrides[s.name] !== undefined) s.disable = this.overrides[s.name];
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }
  enabled() { return this.scan().filter((s) => !s.disable); }
  read(name) {
    const s = this.scan().find((x) => x.name === name);
    if (!s) return null;
    return { name: s.name, description: s.description, disable: s.disable, body: s.body, dir: s.dir, files: s.files };
  }
  setEnabled(name, enabled) { this.overrides[name] = !enabled; }
}

/** Install a skill from a zip or directory into the user skills dir (F12). */
async function installSkill(source, userSkillsDir, extractZip) {
  fs.mkdirSync(userSkillsDir, { recursive: true });
  let srcDir = null;
  const tmp = path.join(userSkillsDir, '.import-' + Date.now());
  if (source.toLowerCase().endsWith('.zip')) {
    if (!extractZip) throw new Error('zip import unsupported');
    await extractZip(source, tmp);
    srcDir = findSkillRoot(tmp);
  } else {
    srcDir = findSkillRoot(source);
  }
  if (!srcDir) throw new Error('no SKILL.md found in ' + source);
  const { meta } = parseFrontmatter(fs.readFileSync(path.join(srcDir, 'SKILL.md'), 'utf8'));
  const name = meta.name || path.basename(srcDir);
  const dest = path.join(userSkillsDir, name);
  if (fs.existsSync(dest)) throw new Error('skill already installed: ' + name + ' (use force)');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // install = copy (marketplace semantics: source stays intact)
  fs.cpSync(srcDir, dest, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  return { name, dir: dest };
}

function findSkillRoot(dir) {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const r = findSkillRoot(path.join(dir, e.name));
      if (r) return r;
    }
  }
  return null;
}

function uninstallSkill(name, userSkillsDir) {
  const dest = path.join(userSkillsDir, name);
  if (!fs.existsSync(dest)) throw new Error('not installed: ' + name);
  fs.rmSync(dest, { recursive: true, force: true });
  return true;
}

module.exports = { SkillRegistry, parseFrontmatter, installSkill, uninstallSkill, scanSkillDir };
