'use strict';
// T62 integration (F66, design/46): a real daemon + engine turn driven by the
// mock LLM leaves a complete, verifiable execution trace — prompt, model
// steps, tool calls with arguments, policy decisions incl. human approval,
// the delivered artifact with the sha256 of the bytes on disk, turn end.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');

async function setup(t, mode = 'craft') {
  const mock = await startMockLlm();
  const home = makeTempHome('t62');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t62-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  await d.request('settings.set', { key: 'llm.model', value: 'mock-model' });
  await d.request('settings.set', { key: 'llm.apiKey', value: 'sk-T62SECRETVALUE0123456789' });
  const s = await d.request('sessions.create', { title: 'T62', mode, cwd: ws });
  return { mock, d, ws, home, sessionId: s.result.id };
}

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const done = (d, sid) => d.waitEvent((m) => m.topic === 'engine:' + sid && m.payload.type === 'done', 20000);

test('T62 a delivering turn is traced end to end and the artifact hash matches the file', { timeout: 60000 }, async (t) => {
  const { mock, d, ws, sessionId } = await setup(t);
  const target = path.join(ws, 'report.md');
  mock.push([
    { tool_calls: [call('l1', 'list_dir', { path: ws })] },
    { tool_calls: [call('w1', 'write_file', { path: target, content: '# Q3 report\nrevenue +12%' })] },
    { content: 'Report written to report.md' },
  ]);
  await d.request('engine.start', { sessionId });
  // the key must never appear in the trace even when the user pastes it
  await d.request('engine.userMessage', { sessionId, text: 'write the Q3 report (key sk-T62SECRETVALUE0123456789)' });
  await done(d, sessionId);

  const recs = (await d.request('trace.get', { sessionId, turn: 1 })).result;
  const kinds = recs.map((r) => r.kind);
  assert.deepEqual(kinds, ['turn_start', 'llm_step', 'tool_call', 'tool_result', 'llm_step', 'tool_call', 'tool_result', 'llm_step', 'turn_end']);
  const start = recs[0];
  assert.equal(start.source, 'user');
  assert.equal(start.mode, 'craft');
  assert.equal(start.model, 'mock-model');
  assert.ok(!JSON.stringify(recs).includes('T62SECRETVALUE'), 'vault secret redacted');

  const write = recs.find((r) => r.kind === 'tool_call' && r.name === 'write_file');
  assert.equal(write.toolKind, 'write');
  assert.ok(write.args.includes('report.md'), 'arguments recorded');
  const res = recs.find((r) => r.kind === 'tool_result' && r.name === 'write_file');
  assert.equal(res.ok, true);
  assert.equal(res.policy, 'allow');
  assert.ok(Number.isFinite(res.ms));
  const disk = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  assert.equal(res.artifact.path, target);
  assert.equal(res.artifact.sha256, disk, 'trace fingerprints the delivered bytes');
  assert.ok(res.artifact.snapshot, 'linked to the F58 snapshot version');
  const end = recs.at(-1);
  assert.equal(end.reason, 'complete');
  assert.deepEqual(end.artifacts, [target]);
  assert.match(end.reply, /Report written/);

  const fa = (await d.request('trace.forArtifact', { sessionId, path: target })).result;
  assert.equal(fa.turn, 1);
  assert.deepEqual((await d.request('trace.verify', { sessionId })).result, { ok: true, count: recs.length });
  const list = (await d.request('trace.list', { sessionId })).result;
  assert.equal(list.length, 1);
  assert.equal(list[0].tools, 2);
  const md = (await d.request('trace.export', { sessionId, turn: 1, format: 'md' })).result;
  assert.ok(md.content.includes(disk) && md.content.includes('T62'), 'report carries the hash and the session title');
});

test('T62 human approval is recorded: approved, denied and the policy on the result', { timeout: 60000 }, async (t) => {
  const { mock, d, ws, sessionId } = await setup(t, 'plan');
  mock.push([
    { tool_calls: [call('w1', 'write_file', { path: path.join(ws, 'a.txt'), content: 'A' })] },
    { tool_calls: [call('w2', 'write_file', { path: path.join(ws, 'b.txt'), content: 'B' })] },
    { content: 'one approved, one denied' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'write two files' });
  const c1 = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'confirm_request', 15000);
  await d.request('engine.confirm', { id: c1.payload.id, approved: true });
  const c2 = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'confirm_request' && m.payload.id !== c1.payload.id, 15000);
  await d.request('engine.confirm', { id: c2.payload.id, approved: false });
  await done(d, sessionId);

  const recs = (await d.request('trace.get', { sessionId })).result;
  const confirms = recs.filter((r) => r.kind === 'confirm');
  assert.deepEqual(confirms.map((r) => r.outcome), ['approved', 'denied']);
  assert.ok(confirms[0].describe.includes('a.txt'));
  const results = recs.filter((r) => r.kind === 'tool_result');
  assert.deepEqual(results.map((r) => r.policy), ['confirmed', 'denied']);
  assert.deepEqual(results.map((r) => r.ok), [true, false]);
  assert.ok(fs.existsSync(path.join(ws, 'a.txt')) && !fs.existsSync(path.join(ws, 'b.txt')));
});

test('T62 deleting a session deletes its trace; trace.enable=false records nothing', { timeout: 60000 }, async (t) => {
  const { mock, d, home, sessionId } = await setup(t);
  mock.push([{ content: 'hi' }]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'hello' });
  await done(d, sessionId);
  const file = path.join(home, 'traces', sessionId + '.jsonl');
  assert.ok(fs.existsSync(file));
  await d.request('sessions.delete', { id: sessionId });
  assert.ok(!fs.existsSync(file), 'trace removed with its session');

  await d.request('settings.set', { key: 'trace.enable', value: false });
  const s2 = (await d.request('sessions.create', { title: 'off', mode: 'craft' })).result;
  mock.push([{ content: 'quiet' }]);
  await d.request('engine.start', { sessionId: s2.id });
  await d.request('engine.userMessage', { sessionId: s2.id, text: 'hello' });
  await done(d, s2.id);
  assert.deepEqual((await d.request('trace.get', { sessionId: s2.id })).result, []);
});
