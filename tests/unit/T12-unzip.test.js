'use strict';
// T12d: pure-JS zip extractor — round trip, and zip-slip fails closed with
// nothing written.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractZip } = require('../../app/daemon/unzip');
const { zipDirSync } = require('../helpers');

function stage(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t12d-' + tag + '-'));
  fs.mkdirSync(path.join(dir, 'src', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'SKILL.md'), '---\nname: z\n---\n# z\n');
  fs.writeFileSync(path.join(dir, 'src', 'sub', 'data.txt'), 'x'.repeat(5000));
  return dir;
}

test('T12d extractZip round-trips nested deflate entries', async () => {
  const dir = stage('ok');
  const zip = zipDirSync(path.join(dir, 'src'), path.join(dir, 'a.zip'), { prefix: 'pack/' });
  await extractZip(zip, path.join(dir, 'out'));
  assert.match(fs.readFileSync(path.join(dir, 'out', 'pack', 'SKILL.md'), 'utf8'), /name: z/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'out', 'pack', 'sub', 'data.txt'), 'utf8').length, 5000);
});

test('T12d extractZip refuses zip-slip entries and writes nothing', async () => {
  const dir = stage('slip');
  const zip = zipDirSync(path.join(dir, 'src'), path.join(dir, 'b.zip'), { prefix: '../escape/' });
  await assert.rejects(extractZip(zip, path.join(dir, 'out')), /escapes destination/);
  assert.ok(!fs.existsSync(path.join(dir, 'escape')));
  assert.ok(!fs.existsSync(path.join(dir, 'out')));
});

test('T12d extractZip rejects non-zip input', async () => {
  const dir = stage('bad');
  fs.writeFileSync(path.join(dir, 'c.zip'), 'not a zip at all');
  await assert.rejects(extractZip(path.join(dir, 'c.zip'), path.join(dir, 'out')), /not a zip/);
});
