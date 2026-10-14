'use strict';
// T27: cloud sandbox adapter (e2b-compatible surface) against a mock cloud
// HTTP service: fs/exec roundtrip, 401 → single shared reconnect → success,
// persistent 401 → fail-closed, 10s reconnect dedup.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { CloudSandbox } = require('../../app/engine/cloud-sandbox');

function mockCloud({ validKey = 'k1' } = {}) {
  const state = { files: new Map(), probes: 0, authFailures: 0 };
  const server = http.createServer((req, res) => {
    const key = req.headers['x-api-key'];
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (key !== state.currentKey) {
      state.authFailures++;
      json(401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/sandboxes/sb1/files?path=')) {
      const p = decodeURIComponent(req.url.split('path=')[1]);
      const base = p.replace(/\/+$/, '') + '/';
      const under = [...state.files.entries()].filter(([fp]) => fp === p || fp.startsWith(base));
      json(200, { entries: under.map(([fp, content]) => ({ path: fp, type: 'file', size: content.length })) });
      return;
    }
    if (req.method === 'POST' && req.url === '/sandboxes/sb1/files') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const { path: fp, content } = JSON.parse(b);
        state.files.set(fp, content);
        json(200, { ok: true });
      });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/sandboxes/sb1/files/content?path=')) {
      const p = decodeURIComponent(req.url.split('path=')[1].split('&')[0]);
      if (!state.files.has(p)) json(404, { error: 'not found' });
      else json(200, { content: state.files.get(p) });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/sandboxes/sb1/files/exists?path=')) {
      // the adapter uses this endpoint as its reconnect probe; count successes
      state.probes++;
      const p = decodeURIComponent(req.url.split('path=')[1]);
      json(200, { exists: state.files.has(p) });
      return;
    }
    if (req.method === 'POST' && req.url === '/sandboxes/sb1/commands/run') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const { command } = JSON.parse(b);
        json(200, { exitCode: 0, stdout: 'ran:' + command, stderr: '' });
      });
      return;
    }
    json(404, { error: 'no route' });
  });
  state.currentKey = validKey;
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server, state, base: 'http://127.0.0.1:' + server.address().port,
    }));
  });
}

function makeSandbox(base, state, keyRef) {
  return new CloudSandbox({
    apiUrl: base, sandboxId: 'sb1', apiKey: keyRef.current,
    reconnectFn: async () => {
      // rotate to the currently valid key (simulates fresh credentials)
      keyRef.current = state.currentKey;
      return { apiUrl: base, sandboxId: 'sb1', apiKey: keyRef.current };
    },
  });
}

test('T27 fs/exec roundtrip on the cloud backend', { timeout: 30000 }, async (t) => {
  const { server, state, base } = await mockCloud();
  t.after(() => server.close());
  const sb = makeSandbox(base, state, { current: 'k1' });
  await sb.write('/home/ubuntu/out.txt', 'cloud hello');
  assert.strictEqual(await sb.exists('/home/ubuntu/out.txt'), true);
  const r = await sb.read('/home/ubuntu/out.txt');
  assert.strictEqual(r.content, 'cloud hello');
  const listing = await sb.list('/home/ubuntu');
  assert.strictEqual(listing.entries.length, 1);
  const cmd = await sb.execCommand('ls -la');
  assert.strictEqual(cmd.code, 0);
  assert.ok(cmd.stdout.includes('ran:ls -la'));
});

test('T27 401 triggers exactly one shared reconnect then succeeds', { timeout: 30000 }, async (t) => {
  const { server, state, base } = await mockCloud();
  t.after(() => server.close());
  const keyRef = { current: 'stale-key' };
  const sb = makeSandbox(base, state, keyRef);
  // state.currentKey is the valid one ('k1'); stale key gets 401s
  await sb.write('/f.txt', 'x'); // 401 → reconnect (keyRef updated to k1) → retry OK
  const probesAfterWrite = state.probes;
  assert.strictEqual(keyRef.current, 'k1');
  assert.strictEqual(await sb.exists('/f.txt'), true, 'write succeeded after reconnect');
  assert.strictEqual(probesAfterWrite, 1, 'single reconnect probe (got ' + probesAfterWrite + ')');
});

test('T27 concurrent auth failures share one reconnect attempt', { timeout: 30000 }, async (t) => {
  const { server, state, base } = await mockCloud();
  t.after(() => server.close());
  const keyRef = { current: 'stale-key' };
  const sb = makeSandbox(base, state, keyRef);
  await Promise.all([
    sb.write('/a.txt', '1'),
    sb.write('/b.txt', '2'),
    sb.list('/'),
  ]);
  assert.strictEqual(state.probes, 1, 'reconnect deduped across concurrent ops');
});

test('T27 reconnect throttle: second auth error within 10s fails closed', { timeout: 30000 }, async (t) => {
  const { server, state, base } = await mockCloud();
  t.after(() => server.close());
  // key never becomes valid again: reconnect probes also 401
  state.currentKey = 'k1';
  const keyRef = { current: 'stale-key' };
  const sb = new CloudSandbox({
    apiUrl: base, sandboxId: 'sb1', apiKey: keyRef.current,
    reconnectFn: async () => ({ apiUrl: base, sandboxId: 'sb1', apiKey: 'still-wrong' }),
  });
  const r1 = await sb.write('/x.txt', 'x').catch((e) => ({ __err: e.message }));
  assert.ok(r1.__err, 'first op fails (reconnect probe itself 401s)');
  const probesAfterFirst = state.authFailures;
  const r2 = await sb.write('/y.txt', 'y').catch((e) => ({ __err: e.message }));
  assert.ok(r2.__err, 'still failing');
  assert.strictEqual(state.probes, 0, 'probe never succeeded');
  assert.ok(state.authFailures >= probesAfterFirst, 'auth kept failing (fail-closed, no silent success)');
});

test('T27 tool layer routes through the cloud backend', { timeout: 30000 }, async (t) => {
  const { server, state, base } = await mockCloud();
  t.after(() => server.close());
  const { makeTools } = require('../../app/engine/tools');
  const sb = makeSandbox(base, state, { current: 'k1' });
  const tools = makeTools({ sandbox: { workspace: '/unused', checkFile: () => ({ ok: true }), checkCommand: () => ({ verdict: 'allow' }) }, cloud: sb });
  const w = await tools.tools.write_file.run({ path: '/tools.txt', content: 'via tools' });
  assert.strictEqual(w.ok, true);
  assert.ok(w.summary.startsWith('cloud:'));
  const r = await tools.tools.read_file.run({ path: '/tools.txt' });
  assert.ok(r.data.content.includes('via tools'));
  const c = await tools.tools.run_command.run({ command: 'echo hi' });
  assert.strictEqual(c.ok, true);
  assert.ok(c.data.stdout.includes('ran:echo hi'));
});
