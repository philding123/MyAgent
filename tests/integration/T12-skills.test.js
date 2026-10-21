'use strict';
// T12: local skill marketplace (install/scan/uninstall) + T11 system prompt injection.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon, zipDirSync } = require('../helpers');

function makeSkillDir(root, name, description) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\ndisable: false\n---\n\n# ${name}\nDo the thing.\n`);
  return dir;
}

test('T12c builtin evidence-check skill is scanned and readable (skill-parity method)', { timeout: 30000 }, async (t) => {
  const home = makeTempHome('t45');
  const d = forkDaemon(home);
  t.after(() => d.child.kill());
  const list = await d.request('skills.list');
  const ec = list.result.find((s) => s.name === 'evidence-check');
  assert.ok(ec, 'evidence-check in builtin scan');
  assert.strictEqual(ec.source, 'builtin');
  const read = await d.request('skills.read', { name: 'evidence-check' });
  assert.match(read.result.body, /Evidence 记录/);
  assert.match(read.result.body, /大白话/);
});

test('T12a install from directory, list, uninstall', { timeout: 30000 }, async (t) => {
  const home = makeTempHome('t12');
  const d = forkDaemon(home);
  t.after(() => d.child.kill());
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t12-src-'));
  makeSkillDir(src, 'imported-skill', 'imported from dir');
  const r = await d.request('skills.install', { source: path.join(src, 'imported-skill') });
  assert.strictEqual(r.result.name, 'imported-skill');
  const list = await d.request('skills.list');
  assert.ok(list.result.some((s) => s.name === 'imported-skill' && s.source === 'user'));
  // duplicate install errors
  const dup = await d.request('skills.install', { source: path.join(src, 'imported-skill') });
  assert.strictEqual(dup.ok, false);
  assert.match(dup.error.message, /already installed/);
  await d.request('skills.uninstall', { name: 'imported-skill' });
  const after = await d.request('skills.list');
  assert.ok(!after.result.some((s) => s.name === 'imported-skill'));
});

test('T12b install from zip (pure-JS extractor, every OS)', { timeout: 60000 }, async (t) => {
  const home = makeTempHome('t12z');
  const d = forkDaemon(home);
  t.after(() => d.child.kill());
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t12-zip-'));
  makeSkillDir(path.join(stage, 'payload'), 'zipped-skill', 'came from a zip');
  const zip = path.join(stage, 'zipped-skill.zip');
  zipDirSync(path.join(stage, 'payload'), zip, { prefix: 'payload/' });
  const r = await d.request('skills.install', { source: zip });
  assert.strictEqual(r.result.name, 'zipped-skill');
  const list = await d.request('skills.list');
  assert.ok(list.result.some((s) => s.name === 'zipped-skill'));
  const read = await d.request('skills.read', { name: 'zipped-skill' });
  assert.match(read.result.body, /# zipped-skill/);
});

test('T11b enabled skills appear in engine system prompt; skill_read works', { timeout: 30000 }, async (t) => {
  const mock = await startMockLlm();
  const home = makeTempHome('t11b');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t11b-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  mock.push([
    { content: 'loading the skill', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'skill_read', arguments: '{"name":"note-organizer"}' } }] },
    { content: 'skill loaded' },
  ]);
  const s = await d.request('sessions.create', { title: 'T11b', cwd: ws });
  await d.request('engine.start', { sessionId: s.result.id });
  await d.request('engine.userMessage', { sessionId: s.result.id, text: 'organize notes' });
  await d.waitEvent((m) => m.topic === 'engine:' + s.result.id && m.payload.type === 'done', 15000);
  const sys = mock.requests[0].messages[0].content;
  assert.match(sys, /note-organizer/);
  assert.match(sys, /Organize messy notes/);
  const tr = d.events.find((m) => m.payload.type === 'tool_result');
  assert.strictEqual(tr.payload.ok, true, 'skill_read succeeded');
  // second LLM request carries the tool result with skill body
  const toolMsg = mock.requests[1].messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg.content.includes('Note Organizer'), 'skill body returned to model');
});
