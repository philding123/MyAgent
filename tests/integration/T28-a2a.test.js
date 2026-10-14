'use strict';
// T28: A2A server (message/send over loopback) + agent_delegate client, with
// a mock LLM behind the engine turn.
const test = require('node:test');
const assert = require('node:assert');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');
const { agentCard, delegate } = require('../../app/daemon/a2a');
const crypto = require('node:crypto');

test('T28 message/send roundtrip + delegate client + card shape', { timeout: 60000 }, async (t) => {
  const mock = await startMockLlm();
  mock.push([{ content: 'A2A reply from engine' }]);
  const home = makeTempHome('t28');
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.waitEvent((m) => m.topic === 'daemon:ready', 15000);
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  await d.request('settings.set', { key: 'llm.model', value: 'mock-model' });

  const en = await d.request('a2a.enable', { enabled: true });
  assert.strictEqual(en.result.ok, true);
  assert.ok(en.result.url.startsWith('http://127.0.0.1:'));

  // AgentCard over HTTP
  const cardRes = await fetch(en.result.url + '/.well-known/agent.json');
  assert.strictEqual(cardRes.status, 200);
  const card = await cardRes.json();
  assert.strictEqual(card.name, 'MyAgent');
  assert.strictEqual(card.capabilities.streaming, false);
  assert.ok(card.skills.length >= 1);

  // JSON-RPC message/send
  const rpcRes = await fetch(en.result.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'message/send',
      params: { message: { role: 'user', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: 'hello a2a' }] } },
    }),
  });
  assert.strictEqual(rpcRes.status, 200);
  const rpc = await rpcRes.json();
  assert.ok(!rpc.error, 'no rpc error: ' + JSON.stringify(rpc.error || ''));
  const text = rpc.result.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('');
  assert.ok(text.includes('A2A reply from engine'), 'engine reply carried back: ' + text);

  // unknown method gets a JSON-RPC error
  const bad = await (await fetch(en.result.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'nope' }),
  })).json();
  assert.strictEqual(bad.error.code, -32601);

  // client delegate() against our own card (loopback interop)
  const del = await delegate(en.result.url, 'delegate this', {});
  assert.ok(del.card.name === 'MyAgent');
  assert.ok(typeof del.text === 'string');

  // engine tool agent_delegate exists in definitions
  const { makeTools } = require('../../app/engine/tools');
  const tools = makeTools({ sandbox: { workspace: '.', checkFile: () => ({ ok: true }), checkCommand: () => ({ verdict: 'allow' }) } });
  assert.ok(tools.tools.agent_delegate, 'agent_delegate registered');
  const def = tools.definitions.find((x) => x.function.name === 'agent_delegate');
  assert.ok(def, 'in OpenAI definitions');

  // disable closes the listener
  const off = await d.request('a2a.enable', { enabled: false });
  assert.strictEqual(off.result.ok, true);
  let closed = false;
  try { await fetch(en.result.url + '/.well-known/agent.json'); } catch (_) { closed = true; }
  assert.ok(closed, 'server stopped after disable');
});

test('T28 delegate reports unreachable agent as a value error', { timeout: 30000 }, async () => {
  const { makeTools } = require('../../app/engine/tools');
  const tools = makeTools({ sandbox: { workspace: '.', checkFile: () => ({ ok: true }), checkCommand: () => ({ verdict: 'allow' }) } });
  const r = await tools.tools.agent_delegate.run({ url: 'http://127.0.0.1:1', message: 'x' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.summary.includes('delegate failed'));
});
