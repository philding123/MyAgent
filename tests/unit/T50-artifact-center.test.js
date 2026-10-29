'use strict';
// Exercise the real panel and preview controller in a browser; bundle in memory
// so these units neither rebuild app/dist nor touch application data.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { build } = require('esbuild');
let browser, page, bundle, unavailable;

before(async () => {
  const executablePath = [process.env.MYAGENT_TEST_BROWSER, chromium.executablePath(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && fs.existsSync(p));
  if (!executablePath) { unavailable = 'No local Chromium for artifact-center DOM units'; return; }
  const compiled = await build({ entryPoints: [path.resolve(__dirname, '../../app/renderer/src/artifact-center.js')],
    bundle: true, write: false, format: 'iife', globalName: 'ArtifactModule', platform: 'browser', logLevel: 'silent' });
  bundle = compiled.outputFiles[0].text;
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  if (unavailable) return;
  page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  await page.setContent(`<style>.hidden { display:none!important }</style>
    <button id="btn-artifacts"></button><div id="messages"></div>
    <aside id="artifact-panel" class="hidden">
      <button id="artifact-close">Close</button><div id="artifact-list"></div>
      <strong id="artifact-name"></strong><div id="artifact-path"></div>
      <div class="artifact-actions">
        <button id="artifact-reveal"></button><button id="artifact-open"></button>
        <button id="artifact-copy"></button><button id="artifact-window"></button>
        <button id="artifact-source"></button>
      </div><div id="artifact-status"></div><div id="artifact-preview"></div>
    </aside>`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.calls = [];
    window.record = (sessionId, name, kind = 'working') => ({ schemaVersion: 1, sessionId,
      toolCallId: `${sessionId}:${name}`, path: `C:/workspace/${sessionId}/${name}`, name,
      sourceTool: kind === 'delivered' ? 'present_file' : 'write_file', createdAt: 1, kind, location: 'local' });
    window.center = new ArtifactModule.ArtifactCenter({
      rpc: async (method, params) => {
        calls.push({ method, ...params });
        if (method === 'artifacts.resolve') return { path: params.path };
        if (method === 'files.readBinary') {
          const text = 'CONTENT:' + params.path;
          return { size: text.length, base64: btoa(text) };
        }
        throw new Error('Unexpected RPC: ' + method);
      },
      windowAction: async () => { throw new Error('Native actions are outside these panel units'); },
    });
    // app.js replaces chat history before restoring the panel's session records.
    window.openPanelSession = (id, records = []) => {
      document.getElementById('messages').replaceChildren();
      center.setSession(id, records);
    };
  });
});
afterEach(async () => { await page?.close(); page = null; });
function ready(t) { if (unavailable) { t.skip(unavailable); return false; } return true; }
async function previewReady(expectedPath) {
  await page.waitForFunction((p) => document.getElementById('artifact-status').dataset.state === 'ready'
    && document.getElementById('artifact-preview').textContent === 'CONTENT:' + p, expectedPath);
}

test('T50 artifact panel recreates terminal controllers on session, load and fold transitions', async (t) => {
  if (!ready(t)) return;
  const result = await page.evaluate(async () => {
    const initial = center.preview;
    const first = record('A', 'first.txt');
    openPanelSession('A', [first]);
    const sessionController = center.preview;
    await center.show(first);
    const firstController = center.preview;
    const firstText = document.getElementById('artifact-preview').textContent;
    await center.show(first);
    const secondController = center.preview;
    return {
      sessionReplaced: initial !== sessionController,
      loadReplaced: sessionController !== firstController && firstController !== secondController,
      initialDead: !(await initial.load(first.path)).ok,
      previousDead: !(await firstController.load(first.path)).ok,
      firstText, secondText: document.getElementById('artifact-preview').textContent,
      reads: calls.filter((c) => c.method === 'files.readBinary').length,
    };
  });
  assert.equal(result.sessionReplaced, true);
  assert.equal(result.loadReplaced, true);
  assert.equal(result.initialDead, true);
  assert.equal(result.previousDead, true);
  assert.equal(result.firstText, 'CONTENT:C:/workspace/A/first.txt');
  assert.equal(result.secondText, result.firstText);
  assert.equal(result.reads, 2, 'destroyed controllers must not read files');
  await page.click('#btn-artifacts');
  await previewReady('C:/workspace/A/first.txt');
  await page.click('#artifact-close');
  assert.equal(await page.locator('#artifact-preview').textContent(), '');
  assert.equal(await page.locator('#artifact-panel').isHidden(), true);
  await page.click('#btn-artifacts');
  await previewReady('C:/workspace/A/first.txt');
});

test('T50 manual fold suppresses this turn only; beginTurn permits the next delivery to expand', async (t) => {
  if (!ready(t)) return;
  await page.evaluate(() => {
    openPanelSession('A');
    center.beginTurn();
    center.add(record('A', 'first.txt', 'delivered'));
  });
  await previewReady('C:/workspace/A/first.txt');
  await page.click('#artifact-close');
  const folded = await page.evaluate(() => {
    const callsBefore = calls.length;
    center.add(record('A', 'same-turn.txt', 'delivered'));
    return { collapsed: center.state.userCollapsed, expanded: center.state.expanded,
      selected: center.selected.name, count: center.state.items.size, newCalls: calls.length - callsBefore };
  });
  assert.deepEqual(folded, { collapsed: true, expanded: false, selected: 'same-turn.txt', count: 2, newCalls: 0 });
  assert.equal(await page.locator('#artifact-panel').isHidden(), true);
  const next = await page.evaluate(() => {
    center.beginTurn();
    const beforeDelivery = { collapsed: center.state.userCollapsed, expanded: center.state.expanded };
    center.add(record('A', 'next-turn.txt', 'delivered'));
    return beforeDelivery;
  });
  assert.deepEqual(next, { collapsed: false, expanded: false }, 'beginTurn alone must not open the panel');
  await previewReady('C:/workspace/A/next-turn.txt');
  assert.equal(await page.locator('#artifact-panel').isVisible(), true);
  assert.equal(await page.locator('#btn-artifacts').getAttribute('aria-expanded'), 'true');
});

test('T50 switching sessions restores each selection and expansion without leaking chat cards', async (t) => {
  if (!ready(t)) return;
  await page.evaluate(() => openPanelSession('A', [record('A', 'first.txt'), record('A', 'second.txt')]));
  await page.click('#btn-artifacts');
  await page.locator('.artifact-item').filter({ hasText: 'second.txt' }).click();
  await previewReady('C:/workspace/A/second.txt');
  await page.evaluate(() => openPanelSession('B', [record('B', 'only.txt')]));
  assert.equal(await page.locator('#artifact-panel').isHidden(), true);
  assert.deepEqual(await page.locator('.artifact-card').evaluateAll((cards) => cards.map((c) => c.title)),
    ['C:/workspace/B/only.txt']);
  await page.click('#btn-artifacts');
  await previewReady('C:/workspace/B/only.txt');
  await page.click('#artifact-close');
  await page.evaluate(() => openPanelSession('A', [record('A', 'first.txt'), record('A', 'second.txt')]));
  await previewReady('C:/workspace/A/second.txt');
  assert.equal(await page.locator('#artifact-path').textContent(), 'C:/workspace/A/second.txt');
  assert.equal(await page.locator('.artifact-item[aria-pressed="true"]').getAttribute('title'), 'C:/workspace/A/second.txt');
  assert.deepEqual(await page.locator('.artifact-card').evaluateAll((cards) => cards.map((c) => c.title)),
    ['C:/workspace/A/first.txt', 'C:/workspace/A/second.txt']);
  await page.evaluate(() => openPanelSession('B', [record('B', 'only.txt')]));
  assert.equal(await page.locator('#artifact-panel').isHidden(), true, 'B must retain its own folded state');
  await page.click('#btn-artifacts');
  await previewReady('C:/workspace/B/only.txt');
});

test('T50 duplicate records update one item/card and cross-session artifacts never enter the active session', async (t) => {
  if (!ready(t)) return;
  const result = await page.evaluate(() => {
    center.beginTurn(); // No active session is also safe.
    center.add(record('A', 'ignored.txt'));
    const a = record('A', 'same.txt');
    const foreign = record('B', 'foreign.txt', 'delivered');
    openPanelSession('A', [a, { ...a, createdAt: 2 }, foreign]);
    center.add({ ...a, toolCallId: 'updated', createdAt: 3 });
    center.add({ ...a, toolCallId: 'updated', createdAt: 3 });
    center.add(foreign);
    center.add({ ...foreign, path: a.path });
    return { size: center.state.items.size, selected: center.selected,
      expanded: center.state.expanded, calls: calls.length,
      cards: [...document.querySelectorAll('.artifact-card')].map((c) => c.title),
      items: [...document.querySelectorAll('.artifact-item')].map((c) => c.title) };
  });
  assert.equal(result.size, 1);
  assert.equal(result.selected.sessionId, 'A');
  assert.equal(result.selected.toolCallId, 'updated');
  assert.equal(result.selected.createdAt, 3);
  assert.equal(result.expanded, false, 'foreign deliveries must not expand A');
  assert.equal(result.calls, 0, 'ignored deliveries must not resolve or read files');
  assert.deepEqual(result.cards, ['C:/workspace/A/same.txt']);
  assert.deepEqual(result.items, result.cards);
  await page.evaluate(() => {
    openPanelSession(null);
    center.add(record('B', 'late.txt', 'delivered'));
  });
  assert.equal(await page.locator('.artifact-card').count(), 0);
  assert.equal(await page.locator('.artifact-item').count(), 0);
  assert.equal(await page.locator('#btn-artifacts').isDisabled(), true);
});
