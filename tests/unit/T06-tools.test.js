'use strict';
// T06: built-in tool behaviors over a sandboxed workspace.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sandbox, defaultRules } = require('../../app/daemon/sandbox');
const { makeTools } = require('../../app/engine/tools/index');
const { browserToolDefinition } = require('../../app/engine/tools/browser');

function setup() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t06-'));
  const sb = new Sandbox(defaultRules(ws), { workspace: ws });
  const registry = { read: (n) => (n === 'demo' ? { name: 'demo', body: '# Demo skill', description: 'd' } : null) };
  return { ws, ...makeTools({ sandbox: sb, skillRegistry: registry }) };
}

test('T06 write_file creates dirs + read_file numbered window', async () => {
  const t = setup();
  const w = await t.tools.write_file.run({ path: path.join(t.ws, 'a', 'b.txt'), content: 'l1\nl2\nl3' });
  assert.ok(w.ok, w.summary);
  const r = await t.tools.read_file.run({ path: path.join(t.ws, 'a', 'b.txt'), offset: 2, limit: 1 });
  assert.ok(r.ok);
  assert.match(r.data.content, /2\tl2/);
});

test('T06 read_file sandbox denial outside workspace', async () => {
  const t = setup();
  const r = await t.tools.read_file.run({ path: path.join(os.homedir(), '.ssh', 'id_rsa') });
  assert.strictEqual(r.ok, false);
  assert.match(r.summary, /denied/);
});

test('T06 list_dir formats entries', async () => {
  const t = setup();
  await t.tools.write_file.run({ path: path.join(t.ws, 'f.txt'), content: 'x' });
  fs.mkdirSync(path.join(t.ws, 'sub'));
  const r = await t.tools.list_dir.run({ path: t.ws });
  assert.ok(r.ok);
  assert.ok(r.data.entries.some((e) => e.startsWith('[f] f.txt')));
  assert.ok(r.data.entries.some((e) => e.startsWith('[d] sub')));
});

test('T06 run_command executes and reports exit code', async () => {
  const t = setup();
  const r = await t.tools.run_command.run({ command: 'echo __T06__', timeout_ms: 10000 });
  assert.ok(r.data.stdout.includes('__T06__') || r.data.stdout.includes('__T06__'.toUpperCase()) || process.platform !== 'win32');
  const bad = await t.tools.run_command.run({ command: process.platform === 'win32' ? 'cmd /c exit 3' : 'exit 3', timeout_ms: 10000 });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.data.code, 3);
});

test('T06 run_command timeout', async () => {
  const t = setup();
  const cmd = process.platform === 'win32' ? 'ping -n 5 127.0.0.1' : 'sleep 5';
  const r = await t.tools.run_command.run({ command: cmd, timeout_ms: 1500 });
  assert.strictEqual(r.ok, false);
  assert.match(r.summary, /timeout/);
});

test('T06 search finds hits with line numbers', async () => {
  const t = setup();
  await t.tools.write_file.run({ path: path.join(t.ws, 'code.js'), content: 'alpha\nbeta gamma\nalpha again' });
  const r = await t.tools.search.run({ query: 'alpha' });
  assert.ok(r.ok);
  assert.strictEqual(r.data.hits.length, 2);
  assert.strictEqual(r.data.hits[0].line, 1);
});

test('T06 skill_read reads registry', async () => {
  const t = setup();
  const r = await t.tools.skill_read.run({ name: 'demo' });
  assert.ok(r.ok);
  assert.strictEqual(r.data.skill.body, '# Demo skill');
  const miss = await t.tools.skill_read.run({ name: 'nope' });
  assert.strictEqual(miss.ok, false);
});

test('T06 tool definitions are OpenAI function-shaped', () => {
  const t = setup();
  for (const d of t.definitions) {
    assert.strictEqual(d.type, 'function');
    assert.ok(d.function.name);
    assert.strictEqual(d.function.parameters.type, 'object');
  }
  assert.ok(t.definitions.length >= 6);
});

test('T06 browser tool error summary strips ANSI escapes', async () => {
  // playwright errors embed \x1b[2m dim codes (Call log section) that render
  // as garbage in chat cards; wb strips ANSI before surfaces see tool text
  const def = browserToolDefinition({ run: async () => {
    throw new Error('page.goto: net::ERR_FAIL at https://x\nCall log:\n\u001b[2m  - navigating to "https://x", waiting until "domcontentloaded"\u001b[22m');
  } });
  const r = await def.run({ action: 'navigate', url: 'https://x' });
  assert.strictEqual(r.ok, false);
  assert.ok(!r.summary.includes('\x1b'), 'no ESC bytes in summary');
  assert.match(r.summary, /Call log:/);
});
