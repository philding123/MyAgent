'use strict';
// T15: global search across sessions + workspace files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeTempHome, forkDaemon } = require('../helpers');

test('T15 message + file hits with locators', { timeout: 30000 }, async (t) => {
  const home = makeTempHome('t15');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t15-ws-'));
  const d = forkDaemon(home);
  t.after(() => d.child.kill());

  const marker = 'NEEDLE-' + Date.now();
  const s = await d.request('sessions.create', { title: 'T15', cwd: ws });
  await d.request('sessions.appendMessage', { session_id: s.result.id, role: 'assistant', content: 'found the ' + marker + ' in chat' });
  fs.writeFileSync(path.join(ws, 'notes.txt'), 'line one\ncontains ' + marker + ' here\nline three');

  const results = await d.request('search.query', { q: marker, sessionId: s.result.id });
  assert.ok(results.result.length >= 2, JSON.stringify(results.result));
  const msg = results.result.find((r) => r.type === 'message');
  const file = results.result.find((r) => r.type === 'file');
  assert.ok(msg && msg.content.includes(marker));
  assert.ok(file && file.path.endsWith('notes.txt') && file.line === 2, JSON.stringify(file));
});
