'use strict';
// T47b: builtin Claude skills market through the real daemon — market.list
// for the hub page, install via RPC, and the engine `market` tool path
// (search → install → skill visible in skills.list).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');

test('T47b market.list exposes the Claude catalog; RPC install lands in skills.list', { timeout: 30000 }, async (t) => {
  const d = forkDaemon(makeTempHome('t47b'));
  t.after(() => d.child.kill());
  await d.waitEvent((m) => m.topic === 'daemon:ready', 15000);
  const ls = await d.request('market.list', {});
  assert.strictEqual(ls.ok, true);
  const cat = ls.result.catalogs.find((c) => c.id === 'builtin:claude-skills');
  assert.ok(cat && cat.plugins >= 15, JSON.stringify(ls.result.catalogs));
  assert.ok(ls.result.plugins.every((p) => typeof p.installed === 'boolean' && typeof p.installable === 'boolean'));
  const st = await d.request('market.status');
  assert.ok(st.result.builtin.some((b) => b.id === 'builtin:claude-skills'));

  const r = await d.request('market.install', { names: ['skill-creator', 'xlsx'] });
  assert.strictEqual(r.result[0].status, 'installed', JSON.stringify(r.result));
  assert.strictEqual(r.result[1].status, 'refused');
  const skills = await d.request('skills.list');
  const sc = skills.result.find((s) => s.name === 'skill-creator');
  assert.ok(sc && sc.source === 'user', 'installed into the user skills dir');
  const after = await d.request('market.list', {});
  assert.strictEqual(after.result.plugins.find((p) => p.name === 'skill-creator').installed, true);

  await d.request('settings.set', { key: 'market.builtin', value: false });
  const off = await d.request('market.list', {});
  assert.strictEqual(off.result.catalogs.length, 0, 'market.builtin=false hides the catalog');
});

test('T47b engine market tool searches and installs from the builtin catalog', { timeout: 30000 }, async (t) => {
  const mock = await startMockLlm();
  const home = makeTempHome('t47e');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t47e-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  mock.push([
    { content: '', tool_calls: [{ id: 'm1', type: 'function', function: { name: 'market', arguments: '{"action":"search","keywords":["playwright"]}' } }] },
    { content: '', tool_calls: [{ id: 'm2', type: 'function', function: { name: 'market', arguments: '{"action":"install","names":["webapp-testing"]}' } }] },
    { content: 'installed' },
    { content: 'second turn' },
  ]);
  const s = await d.request('sessions.create', { title: 'T47', cwd: ws });
  await d.request('engine.start', { sessionId: s.result.id });
  await d.request('engine.userMessage', { sessionId: s.result.id, text: '装一个网页测试技能' });
  await d.waitEvent((m) => m.topic === 'engine:' + s.result.id && m.payload.type === 'done', 20000);

  const searchMsg = mock.requests[1].messages.filter((m) => m.role === 'tool').pop();
  const found = JSON.parse(searchMsg.content);
  const hit = (found.skills || (found.data && found.data.skills) || []).find((x) => x.name === 'webapp-testing');
  assert.ok(hit, 'search result fed back to the model: ' + searchMsg.content.slice(0, 200));
  assert.strictEqual(hit.installable, true);
  const results = d.events.filter((m) => m.payload && m.payload.type === 'tool_result');
  assert.ok(results.some((m) => /webapp-testing=installed/.test(m.payload.summary)), 'install reported');
  const list = await d.request('skills.list');
  assert.ok(list.result.some((x) => x.name === 'webapp-testing'));
});
