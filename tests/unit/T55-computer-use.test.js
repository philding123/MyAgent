'use strict';
// T55 (F59 computer use, design/43): vision-loop message assembly with hard
// caps, browser CUA coordinate actions (gated + bounded), and the OS-level
// computer tool's ref/coordinate discipline over an injected PowerShell
// executor — no real input injection happens here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { buildToolMessage, MAX_IMAGE_B64_CHARS, MAX_IMAGES_PER_TURN } = require('../../app/engine/vision');
const { makeBrowserSession, browserToolDefinition } = require('../../app/engine/tools/browser');
const { makeComputerTool, toSendKeys, comboToSendKeys, computerActionKinds } = require('../../app/engine/tools/computer');

// ---------- vision.buildToolMessage ----------
test('T55 plain results stay JSON strings; image results become text+image_url parts', () => {
  const plain = buildToolMessage('c1', { ok: true, summary: 'x', data: { a: 1 } }, { images: 0 });
  assert.equal(typeof plain.msg.content, 'string');

  const img = buildToolMessage('c2', { ok: true, summary: 'shot', data: { image: { mime: 'image/png', base64: 'QUJD' } } }, { images: 0 });
  assert.deepEqual(Object.keys(img.msg), ['role', 'tool_call_id', 'content']);
  assert.equal(img.msg.role, 'tool');
  assert.equal(img.msg.tool_call_id, 'c2');
  assert.equal(img.msg.content.length, 2);
  assert.equal(img.msg.content[0].type, 'text');
  assert.ok(!img.msg.content[0].text.includes('QUJD'), 'base64 never rides inside the JSON text');
  assert.ok(img.msg.content[0].text.includes('"summary":"shot"'));
  assert.deepEqual(img.msg.content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } });

  const jpeg = buildToolMessage('c3', { ok: true, summary: 's', data: { image: { mime: 'image/jpeg', base64: 'QUJD' }, keep: 7 } }, { images: 1 });
  assert.ok(jpeg.msg.content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
  assert.ok(jpeg.msg.content[0].text.includes('"keep":7'), 'non-image data survives in the text part');
});

test('T55 vision caps fail closed as value errors, never silent truncation', () => {
  const huge = 'A'.repeat(MAX_IMAGE_B64_CHARS + 1);
  const over = buildToolMessage('c1', { ok: true, summary: 'shot', data: { image: { mime: 'image/png', base64: huge } } }, { images: 0 });
  assert.equal(typeof over.msg.content, 'string');
  assert.ok(over.msg.content.includes('exceeds the vision budget'));

  const budget = { images: MAX_IMAGES_PER_TURN };
  const capped = buildToolMessage('c2', { ok: true, summary: 'shot', data: { image: { mime: 'image/png', base64: 'QUJD' } } }, budget);
  assert.ok(capped.msg.content.includes('budget reached'));
  assert.equal(budget.images, MAX_IMAGES_PER_TURN, 'budget not consumed by the refused image');

  const spend = { images: 0 };
  buildToolMessage('c3', { ok: true, summary: 'a', data: { image: { mime: 'image/png', base64: 'QQ==' } } }, spend);
  assert.equal(spend.images, 1, 'accepted image consumes the budget');

  const failed = buildToolMessage('c4', { ok: false, summary: 'no shot', data: { image: { mime: 'image/png', base64: 'QQ==' } } }, spend);
  assert.equal(typeof failed.msg.content, 'string', 'failed results never attach an image');
});

// ---------- browser CUA actions (injected playwright) ----------
function fakePlaywright() {
  const calls = [];
  const keyboard = { press: async (k) => calls.push(['press', k]), type: async (t) => calls.push(['type', t]) };
  const mouse = { click: async (x, y) => calls.push(['mouse', x, y]) };
  const page = {
    setDefaultTimeout: () => {},
    evaluate: async (fn, arg) => { calls.push(['evaluate', arg]); return []; },
    waitForTimeout: async () => {},
    keyboard, mouse,
  };
  return { chromium: { launch: async () => ({ newContext: async () => ({ newPage: async () => page }), close: async () => {} }) }, __calls: calls };
}

test('T55 browser click_at/type_at: exec kinds, cua gate, viewport bounds, mouse dispatch', async () => {
  assert.equal(computerActionKindProxy('click_at'), 'exec');
  assert.equal(computerActionKindProxy('type_at'), 'exec');
  assert.equal(computerActionKindProxy('screenshot'), 'read');

  const pw = fakePlaywright();
  const session = makeBrowserSession({ playwright: pw });
  const off = browserToolDefinition(session, { cuaEnabled: () => false });
  const denied = await off.run({ action: 'click_at', x: 10, y: 10 });
  assert.equal(denied.ok, false);
  assert.ok(denied.summary.includes('computer use enabled'), denied.summary);

  const on = browserToolDefinition(session, { cuaEnabled: () => true });
  const bounds = await on.run({ action: 'click_at', x: 1300, y: 10 });
  assert.equal(bounds.ok, false);
  assert.ok(bounds.summary.includes('outside the 1280x800 viewport'), bounds.summary);
  const frac = await on.run({ action: 'click_at', x: 10.5, y: 10 });
  assert.equal(frac.ok, false);
  assert.ok(frac.summary.includes('integers'));

  const click = await on.run({ action: 'click_at', x: 640, y: 400 });
  assert.equal(click.ok, true, click.summary);
  assert.deepEqual(pw.__calls.find((c) => c[0] === 'mouse'), ['mouse', 640, 400]);

  const typed = await on.run({ action: 'type_at', x: 100, y: 200, text: 'hi' });
  assert.equal(typed.ok, true);
  assert.ok(pw.__calls.some((c) => c[0] === 'type' && c[1] === 'hi'));
  const empty = await on.run({ action: 'type_at', x: 100, y: 200, text: '' });
  assert.equal(empty.ok, false);
});

function computerActionKindProxy(action) {
  // browser ACTION_KINDS is module-scoped; mirror through a definition probe
  return require('../../app/engine/tools/browser').ACTION_KINDS[action];
}

// ---------- computer tool (injected PowerShell executor) ----------
function makeTool(execCalls, reply) {
  const calls = [];
  const exec = async (args) => { calls.push(args); return reply ? reply(args) : { code: 0, stdout: 'ok', stderr: '' }; };
  const tool = makeComputerTool({ exec, platform: 'win32' });
  return { tool, calls };
}

const WIN_JSON = JSON.stringify([
  { Hwnd: 101, Pid: 1, Title: 'Untitled - Notepad', Process: 'notepad', X: 10, Y: 20, W: 800, H: 600 },
  { Hwnd: 102, Pid: 2, Title: 'Editor', Process: 'code', X: 0, Y: 0, W: 1920, H: 1080 },
]);

test('T55 computer kinds: screenshot/list read, open_app/click/type/key exec', () => {
  assert.deepEqual(computerActionKinds, {
    screenshot: 'read', list_windows: 'read', open_app: 'exec', click: 'exec', type: 'exec', key: 'exec',
  });
});

test('T55 list_windows normalizes one/many PS rows into refs', async () => {
  const { tool } = makeTool(null, () => ({ code: 0, stdout: JSON.stringify({ Hwnd: 5, Pid: 1, Title: 'Solo', Process: 'app', X: 1, Y: 2, W: 300, H: 200 }), stderr: '' }));
  const one = await tool.run({ action: 'list_windows' });
  assert.equal(one.ok, true);
  assert.deepEqual(one.data.windows[0], { ref: 'w1', title: 'Solo', process: 'app', rect: { x: 1, y: 2, w: 300, h: 200 } });

  const many = makeTool(null, () => ({ code: 0, stdout: WIN_JSON, stderr: '' }));
  const two = await many.tool.run({ action: 'list_windows' });
  assert.deepEqual(two.data.windows.map((w) => w.ref), ['w1', 'w2']);
});

test('T55 click/type/key require a fresh ref and stay inside the window rect', async () => {
  const { tool, calls } = makeTool(null, () => ({ code: 0, stdout: WIN_JSON, stderr: '' }));
  await tool.run({ action: 'list_windows' });

  const stale = await tool.run({ action: 'click', ref: 'w9', x: 5, y: 5 });
  assert.equal(stale.ok, false);
  assert.ok(stale.summary.includes('list_windows first'));

  const outside = await tool.run({ action: 'click', ref: 'w1', x: 900, y: 5 });
  assert.equal(outside.ok, false);
  assert.ok(outside.summary.includes('outside the window rect'));

  const click = await tool.run({ action: 'click', ref: 'w1', x: 40, y: 30 });
  assert.equal(click.ok, true, click.summary);
  // front first, then the ABSOLUTE coordinate (window 10,20 + relative 40,30)
  assert.deepEqual(calls[1].slice(1), ['front', '-Hwnd', '101'], 'front targets the listed hwnd');
  const clickArgs = calls.find((c) => c[1] === 'click');
  assert.deepEqual(clickArgs.slice(2), ['-X', '50', '-Y', '50']);

  const typed = await tool.run({ action: 'type', ref: 'w2', text: 'a+b(c)' });
  assert.equal(typed.ok, true);
  const keyArgs = calls.filter((c) => c[1] === 'key').map((c) => c[3]);
  assert.deepEqual(keyArgs, ['a{+}b{(}c{)}'], 'SendKeys specials escaped');

  const combo = await tool.run({ action: 'key', ref: 'w2', combo: 'enter' });
  assert.equal(combo.ok, true);
  assert.equal(calls.filter((c) => c[1] === 'key').at(-1)[3], '{ENTER}');
  const bad = await tool.run({ action: 'key', ref: 'w2', combo: 'ctrl+f5' });
  assert.equal(bad.ok, false);
});

test('T55 open_app refuses documents, passes applications; PS failures are values', async () => {
  const { tool, calls } = makeTool();
  const doc = await tool.run({ action: 'open_app', target: 'C:/docs/report.docx' });
  assert.equal(doc.ok, false);
  assert.ok(doc.summary.includes('present_file'));

  const app = await tool.run({ action: 'open_app', target: 'notepad' });
  assert.equal(app.ok, true);
  assert.deepEqual(calls[0].slice(1, 3), ['open', '-Target']);
  assert.equal(calls[0][3], 'notepad');

  const failing = makeTool(null, () => ({ code: 1, stdout: '', stderr: 'powershell is not here' }));
  const err = await failing.tool.run({ action: 'list_windows' });
  assert.equal(err.ok, false);
  assert.ok(err.summary.includes('powershell'));
});

test('T55 screenshot without a ref captures the screen; with a ref targets that window', async () => {
  const reply = (args) => {
    if (args[1] === 'list') return { code: 0, stdout: WIN_JSON, stderr: '' };
    const outIdx = args.indexOf('-Out'); // the shot flow reads this file back
    if (outIdx >= 0) { fs.writeFileSync(args[outIdx + 1], Buffer.from('89504e47', 'hex')); }
    return { code: 0, stdout: 'shot 800x600', stderr: '' };
  };
  const { tool, calls } = makeTool(null, reply);
  const stale = await tool.run({ action: 'screenshot', ref: 'w9' });
  assert.equal(stale.ok, false);
  assert.ok(stale.summary.includes('list_windows first'));

  await tool.run({ action: 'list_windows' });
  const win = await tool.run({ action: 'screenshot', ref: 'w2' });
  assert.equal(win.ok, true);
  const shotCall = calls.find((c) => c[1] === 'shot');
  assert.deepEqual(shotCall.slice(-2), ['-Hwnd', '102'], 'ref routes to PrintWindow with the listed hwnd');
  const screen = await tool.run({ action: 'screenshot' });
  assert.equal(screen.ok, true);
  assert.ok(!calls.at(-1).includes('-Hwnd'), 'no ref = primary screen capture');
});

test('T55 non-win32 platforms degrade to honest environment errors', async () => {
  const tool = makeComputerTool({ platform: 'linux' });
  const shot = await tool.run({ action: 'screenshot' });
  assert.equal(shot.ok, false);
  assert.ok(shot.summary.includes('requires Windows'));
});

test('T55 SendKeys mapping: specials escaped, combos translated, junk refused', () => {
  assert.equal(toSendKeys('a+b%'), 'a{+}b{%}');
  assert.equal(comboToSendKeys('ctrl+s'), '^s');
  assert.equal(comboToSendKeys('shift+a'), '+a');
  assert.equal(comboToSendKeys('ENTER'), '{ENTER}');
  assert.equal(comboToSendKeys('ctrl+enter'), null);
  assert.equal(comboToSendKeys('f5'), null);
  assert.equal(comboToSendKeys(''), null);
});
