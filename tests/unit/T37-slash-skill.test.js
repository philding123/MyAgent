'use strict';
// T37b: composer 「/技能名」 really invokes the skill — the SKILL.md body is
// attached for the engine; unknown/disabled names and mid-text slashes are
// left alone.
const test = require('node:test');
const assert = require('node:assert');
const { augmentSkill } = require('../../app/daemon/context');

const skills = { 'mcp-builder': { name: 'mcp-builder', body: '# MCP Server Development Guide\nstep 1', dir: '/s/mcp-builder' } };
const find = (n) => skills[n];

test('T37b leading /skill attaches that skill body', () => {
  const r = augmentSkill('/mcp-builder 帮我写个服务器', find);
  assert.strictEqual(r.skill, 'mcp-builder');
  assert.ok(r.text.startsWith('/mcp-builder 帮我写个服务器'));
  assert.match(r.text, /<skill name="mcp-builder">[\s\S]*MCP Server Development Guide[\s\S]*<\/skill>/);
  assert.match(r.text, /\/s\/mcp-builder/);
});

test('T37b unknown skill, mid-text slash and paths are untouched', () => {
  for (const t of ['/nope do it', 'see /mcp-builder later', '/tmp/x.txt 读一下', 'plain']) {
    const r = augmentSkill(t, find);
    assert.strictEqual(r.skill, null, t);
    assert.strictEqual(r.text, t, t);
  }
});
