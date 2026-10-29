'use strict';
// T55 integration (F59, design/43): the vision loop over the real daemon —
// a scripted model drives browser navigate → screenshot → click_at → content
// on a local fixture page; the NEXT LLM request must carry the screenshot as
// an image_url part (that is the whole point of the loop), and the default
// OFF gate must refuse coordinate actions with an honest value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('node:http');
const os = require('os');
const path = require('path');
const { startMockLlm } = require('../../scripts/mock-llm.mjs');
const { makeTempHome, forkDaemon } = require('../helpers');
const { probeBrowser } = require('../../app/shared/browser-probe');

const PAGE = `<!doctype html><html><head><title>T55 fixture</title></head><body style="margin:0">
<p id="p" style="position:absolute;left:16px;top:16px">before</p>
<button id="b" style="position:absolute;left:200px;top:150px;width:120px;height:40px">go</button>
<script>document.getElementById('b').onclick = () => { document.getElementById('p').textContent = 'after'; };</script>
</body></html>`;

function servePage() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function setup(t) {
  const mock = await startMockLlm();
  const home = makeTempHome('t55');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-t55-ws-'));
  const d = forkDaemon(home);
  t.after(async () => { d.child.kill(); await mock.close(); });
  await d.request('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
  await d.request('settings.set', { key: 'llm.model', value: 'mock-model' });
  const s = await d.request('sessions.create', { title: 'T55', mode: 'craft', cwd: ws });
  return { mock, d, ws, sessionId: s.result.id };
}

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('T55 vision loop: screenshot rides as image_url and CUA click changes the page', { timeout: 120000 }, async (t) => {
  if (!probeBrowser().available) { t.skip('no system browser or playwright-core (DEGRADED)'); return; }
  const { mock, d, sessionId } = await setup(t);
  await d.request('settings.set', { key: 'computerUse.enable', value: true });
  const { server, base } = await servePage();
  t.after(() => server.close());

  mock.push([
    { tool_calls: [call('n1', 'browser', { action: 'navigate', url: base }), call('s1', 'browser', { action: 'screenshot' })] },
    { tool_calls: [call('c1', 'browser', { action: 'click_at', x: 260, y: 170 }), call('r1', 'browser', { action: 'content' })] },
    { content: 'done with the loop' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'look and click' });
  const done = await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 60000);
  assert.equal(done.payload.reason, 'complete');

  // the request AFTER the screenshot must contain an image_url part
  const withImage = mock.requests.filter((r) => (r.messages || []).some((m) => Array.isArray(m.content)
    && m.content.some((p) => p.type === 'image_url' && String(p.image_url.url).startsWith('data:image/png;base64,'))));
  assert.ok(withImage.length >= 1, 'no image_url part ever reached the model');
  const imgMsg = withImage[0].messages.find((m) => Array.isArray(m.content));
  const textPart = imgMsg.content.find((p) => p.type === 'text');
  assert.ok(!textPart.text.includes('base64'), 'base64 must not duplicate inside the text part');
  assert.equal(imgMsg.role, 'tool');

  // the CUA click actually flipped the fixture page
  const contentReq = mock.requests.at(-1);
  const toolMsgs = (contentReq.messages || []).filter((m) => m.role === 'tool');
  const contentResult = toolMsgs.map((m) => typeof m.content === 'string' ? m.content : m.content[0].text)
    .find((t2) => t2.includes('"content"'));
  assert.ok(contentResult.includes('after'), 'click_at changed the page: ' + contentResult.slice(0, 200));
});

test('T55 default OFF: coordinate actions refuse without computer use, unknown tool stays a value', { timeout: 60000 }, async (t) => {
  const { mock, d, sessionId } = await setup(t);
  const check = await d.request('app.selfcheck');
  assert.equal(check.result.computerUse.enabled, false, 'gate defaults off in selfcheck');
  assert.equal(check.result.computerUse.platform, process.platform);

  mock.push([
    { tool_calls: [call('c1', 'browser', { action: 'click_at', x: 10, y: 10 }), call('k1', 'computer', { action: 'screenshot' })] },
    { content: 'refused as expected' },
  ]);
  await d.request('engine.start', { sessionId });
  await d.request('engine.userMessage', { sessionId, text: 'try cua' });
  await d.waitEvent((m) => m.topic === 'engine:' + sessionId && m.payload.type === 'done', 30000);
  const tools = mock.requests.at(-1).messages.filter((m) => m.role === 'tool')
    .map((m) => typeof m.content === 'string' ? m.content : m.content[0].text);
  assert.ok(tools.some((t2) => t2.includes('computer use enabled')), 'click_at refused by the gate: ' + JSON.stringify(tools));
  // the computer tool is not even registered while the gate is off
  assert.ok(tools.some((t2) => t2.includes('unknown tool: computer')), 'computer tool absent while disabled');
});
