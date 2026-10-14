'use strict';
// T11: skill frontmatter parsing + registry scan/toggle (F11).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SkillRegistry, parseFrontmatter, scanSkillDir } = require('../../app/daemon/skills');

test('T11 frontmatter parses WorkBuddy-style SKILL.md', () => {
  const { meta, body } = parseFrontmatter(
    '---\nname: skill-creator\ndescription: Guide for creating skills\nallowed-tools:\n  - read_file\n  - write_file\ndisable: false\n---\n\n# Body here\n');
  assert.strictEqual(meta.name, 'skill-creator');
  assert.strictEqual(meta.description, 'Guide for creating skills');
  assert.deepStrictEqual(meta['allowed-tools'], ['read_file', 'write_file']);
  assert.strictEqual(meta.disable, false);
  assert.match(body, /# Body here/);
});

test('T11 frontmatter tolerates missing fields', () => {
  const { meta } = parseFrontmatter('no frontmatter at all');
  assert.deepStrictEqual(meta, {});
});

test('T11 scanSkillDir reads builtin sample', () => {
  const dir = path.join(__dirname, '..', '..', 'skills', 'note-organizer');
  const s = scanSkillDir(dir);
  assert.strictEqual(s.name, 'note-organizer');
  assert.match(s.description, /Organize messy notes/);
  assert.ok(s.files.includes('SKILL.md'));
});

test('T11 registry scan/toggle with builtin + user dirs', () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t11-user-'));
  fs.mkdirSync(path.join(userDir, 'user-skill'));
  fs.writeFileSync(path.join(userDir, 'user-skill', 'SKILL.md'),
    '---\nname: user-skill\ndescription: from user dir\n---\nbody');
  const builtin = path.join(__dirname, '..', '..', 'skills');
  const reg = new SkillRegistry([builtin, userDir]);
  const all = reg.scan();
  const names = all.map((s) => s.name);
  assert.ok(names.includes('note-organizer'));
  assert.ok(names.includes('user-skill'));
  const builtinSkill = all.find((s) => s.name === 'note-organizer');
  assert.strictEqual(builtinSkill.source, 'builtin');
  const userSkill = all.find((s) => s.name === 'user-skill');
  assert.strictEqual(userSkill.source, 'user');
  // toggle off
  reg.setEnabled('user-skill', false);
  assert.ok(reg.scan().find((s) => s.name === 'user-skill').disable);
  assert.strictEqual(reg.enabled().some((s) => s.name === 'user-skill'), false);
  assert.ok(reg.read('user-skill').body.includes('body'));
});

test('T11 disable:true excluded from enabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t11-dis-'));
  fs.mkdirSync(path.join(dir, 'off-skill'));
  fs.writeFileSync(path.join(dir, 'off-skill', 'SKILL.md'),
    '---\nname: off-skill\ndescription: disabled one\ndisable: true\n---\nx');
  const reg = new SkillRegistry([dir]);
  assert.strictEqual(reg.enabled().length, 0);
});
