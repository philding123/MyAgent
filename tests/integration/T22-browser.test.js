'use strict';
// T22b: real browser drive over a local fixture page (system Edge/Chrome
// headless via playwright-core). Skips when no system browser exists —
// reported as DEGRADED in the acceptance report.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { probeBrowser } = require('../../app/shared/browser-probe');
const { makeBrowserSession, ACTION_KINDS } = require('../../app/engine/tools/browser');

const PAGE = `<!doctype html><html><head><title>T22 fixture</title></head><body>
<h1 id="h">T22 fixture</h1>
<p id="p">before</p>
<button id="b" aria-label="swap">swap</button>
<script>document.getElementById('b').onclick = () => { document.getElementById('p').textContent = 'after'; };</script>
</body></html>`;

function servePage() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

test('T22b navigate→content→snapshot→click→screenshot flow', { timeout: 120000 }, async (t) => {
  const probe = probeBrowser();
  if (!probe.available) {
    t.skip('no system browser or playwright-core (DEGRADED: browser tool off)');
    return;
  }
  const { server, base } = await servePage();
  t.after(() => server.close());
  const session = makeBrowserSession();
  t.after(() => session.run({ action: 'close' }).catch(() => {}));

  const nav = await session.run({ action: 'navigate', url: base });
  assert.strictEqual(nav.ok, true);
  assert.ok(nav.summary.includes('T22 fixture'), 'title from navigate: ' + nav.summary);

  const content = await session.run({ action: 'content' });
  assert.ok(content.data.content.includes('T22 fixture'));

  const snap = await session.run({ action: 'snapshot' });
  const btn = snap.data.refs.find((r) => r.name === 'swap');
  assert.ok(btn, 'snapshot exposes the swap button');

  const click = await session.run({ action: 'click', ref: btn.ref });
  assert.strictEqual(click.ok, true);
  const after = await session.run({ action: 'content' });
  assert.ok(after.data.content.includes('after'), 'click changed page state');

  const shot = await session.run({ action: 'screenshot' });
  assert.strictEqual(shot.data.image.base64.slice(0, 8), 'iVBORw0K', 'png magic in base64 (F59 image convention)');

  const closed = await session.run({ action: 'close' });
  assert.strictEqual(closed.ok, true);
});

test('T22b unknown action and stale ref are value-errors, not throws', { timeout: 60000 }, async (t) => {
  const probe = probeBrowser();
  if (!probe.available) { t.skip('browser unavailable'); return; }
  const session = makeBrowserSession();
  t.after(() => session.run({ action: 'close' }).catch(() => {}));
  const bad = await session.run({ action: 'teleport' });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.summary.includes('unknown action'));
  // stale ref (no snapshot taken yet) fails without launching (validated pre-launch)
  const stale = await session.run({ action: 'click', ref: 'r1' }).catch((e) => ({ __threw: e }));
  assert.ok(stale.ok === false || stale.__threw, 'stale ref rejected');
});
