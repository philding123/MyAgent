'use strict';
// T39: present_file delivery tool (F47, wb present_files semantics) — unit
// paths (deliver/sandbox deny/missing); the engine event integration lives in
// tests/integration/T39-present-event.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sandbox, defaultRules } = require('../../app/daemon/sandbox');
const { makePresentTool } = require('../../app/engine/tools/present');

function setupTools(destDir) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t39-'));
  const sb = new Sandbox(defaultRules(ws), { workspace: ws });
  return { ws, tools: makePresentTool({ sandbox: sb, getDestDir: () => destDir }) };
}

test('T39 present_file copies into the delivery stamp folder', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t39-dest-'));
  const { ws, tools } = setupTools(dest);
  fs.writeFileSync(path.join(ws, 'report.html'), '<html>report</html>');
  const r = await tools.run({ path: path.join(ws, 'report.html') });
  assert.ok(r.ok, r.summary);
  const delivered = path.join(dest, 'report.html');
  assert.strictEqual(fs.readFileSync(delivered, 'utf8'), '<html>report</html>');
  assert.match(r.summary, /delivered .+report\.html/);
});

test('T39 present_file refuses outside-workspace and missing files', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t39-dest-'));
  const { tools } = setupTools(dest);
  const outside = await tools.run({ path: path.join(os.homedir(), '.ssh', 'id_rsa') });
  assert.strictEqual(outside.ok, false);
  assert.match(outside.summary, /denied/);
  const missing = await tools.run({ path: path.join(os.tmpdir(), 'no-such-t39-file.txt') });
  assert.strictEqual(missing.ok, false);
  assert.match(missing.summary, /not found/);
});
