'use strict';
// T14: terminal host over the daemon (pty or degraded pipe).
const test = require('node:test');
const assert = require('node:assert');
const { makeTempHome, forkDaemon } = require('../helpers');

test('T14 terminal echo roundtrip', { timeout: 30000 }, async (t) => {
  const home = makeTempHome('t14');
  const d = forkDaemon(home);
  t.after(() => d.child.kill());
  const created = await d.request('terminal.create', {});
  assert.ok(created.result.id);
  assert.ok(['pty', 'pipe'].includes(created.result.kind), 'kind=' + created.result.kind);
  const marker = '__T14__' + Date.now();
  const line = process.platform === 'win32' ? `echo ${marker}\r\n` : `echo ${marker}\n`;
  await d.request('terminal.write', { id: created.result.id, data: line });
  const topic = 'terminal:' + created.result.id + ':data';
  let acc = '';
  let seen = 0;
  const deadline = Date.now() + 15000;
  while (!acc.includes(marker) && Date.now() < deadline) {
    while (seen < d.events.length) {
      const ev = d.events[seen++];
      if (ev.topic === topic) acc += ev.payload.data;
    }
    if (acc.includes(marker)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(acc.includes(marker), 'marker seen in terminal output');
  assert.ok((await d.request('terminal.kill', { id: created.result.id })).result);
});
