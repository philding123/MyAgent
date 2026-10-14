'use strict';
// T23b/T23c: IM channel framework against a scripted mock Telegram Bot API
// (fetchImpl injection — same protocol surface as the real long-poll HTTP).
const test = require('node:test');
const assert = require('node:assert');
const { TelegramChannel, isValidToken } = require('../../app/daemon/im-channels/telegram');
const { ChannelManager, RingDedup } = require('../../app/daemon/im');

const TOKEN = '123456:TESTTOKEN';

function mockTelegram({ updates, sendLog, failPoll = 0 }) {
  let getUpdatesCalls = 0;
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('/getMe')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { id: 123456, username: 'myagent_bot' } }) };
    }
    if (u.includes('/getUpdates')) {
      getUpdatesCalls++;
      if (getUpdatesCalls <= failPoll) {
        throw Object.assign(new Error('network down'), { name: 'TypeError' });
      }
      const batch = updates.splice(0, updates.length);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: batch }) };
    }
    if (u.includes('/sendMessage')) {
      const body = JSON.parse(opts.body);
      sendLog.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: false, status: 404, json: async () => ({ ok: false }) };
  };
}

function buildChannel({ updates, sendLog, failPoll, delayMs }) {
  const fetchImpl = mockTelegram({ updates, sendLog, failPoll });
  const plugin = new TelegramChannel({ fetchImpl, apiBase: 'https://mock.tg', log: () => {} });
  plugin.gateway.delayMs = delayMs || 10;
  return plugin;
}

test('T23b full loop: valid token -> inbound -> dedup -> outbound reply', { timeout: 30000 }, async (t) => {
  const sendLog = [];
  const inbound = [];
  const updates = [
    { update_id: 1, message: { message_id: 100, text: 'hello bot', chat: { id: 42, type: 'private' },
      from: { id: 7, first_name: 'Phil' }, date: Math.floor(Date.now() / 1000) } },
    { update_id: 2, message: { message_id: 100, text: 'hello bot (replayed)', chat: { id: 42, type: 'private' },
      from: { id: 7, first_name: 'Phil' }, date: Math.floor(Date.now() / 1000) } },
  ];
  const plugin = buildChannel({ updates, sendLog });
  // framework-equivalent wiring: dedup + inbound routing
  const dedup = new RingDedup();
  plugin.gateway.onInboundMessage = (msg) => {
    if (dedup.seen(msg.messageId)) return;
    inbound.push(msg);
  };
  plugin.gateway.onConnectionStateChange = () => {};
  plugin.bindCredential({ token: TOKEN });
  await plugin.gateway.startAccount({ credential: { token: TOKEN } });
  await new Promise((r) => setTimeout(r, 150)); // poll drains both updates
  await plugin.gateway.stopAccount();

  assert.strictEqual(inbound.length, 1, 'replayed message_id deduped, got ' + inbound.length);
  assert.strictEqual(inbound[0].sender.senderId, '7');
  assert.strictEqual(inbound[0].replyContext.chatId, 42);
  assert.strictEqual(inbound[0].group, undefined, 'private chat has no group');

  // outbound: reply text goes out as HTML chunk(s)
  plugin.bindCredential({ token: TOKEN });
  const sent = await plugin.outbound.send({ deliveryMode: 'final', text: '**hi** back', replyContext: { chatId: 42 } });
  assert.strictEqual(sent.success, true);
  assert.strictEqual(sendLog.length, 1);
  assert.strictEqual(sendLog[0].parse_mode, 'HTML');
  assert.ok(sendLog[0].text.includes('<b>hi</b>'));
});

test('T23b oversized reply is chunked into multiple sendMessage calls', { timeout: 30000 }, async (t) => {
  const sendLog = [];
  const plugin = buildChannel({ updates: [], sendLog });
  plugin.bindCredential({ token: TOKEN });
  const long = '段落'.repeat(3000); // 6000 chars -> >4000
  const sent = await plugin.outbound.send({ deliveryMode: 'final', text: long, replyContext: { chatId: 1 } });
  assert.strictEqual(sent.success, true);
  assert.ok(sendLog.length >= 2, 'chunked, got ' + sendLog.length);
  for (const b of sendLog) assert.ok(b.text.length <= 4096 + 40);
});

test('T23b invalid token -> AUTH_FAILED nonRecoverable', { timeout: 30000 }, async (t) => {
  const plugin = buildChannel({ updates: [], sendLog: [] });
  let lastState = null;
  plugin.gateway.onConnectionStateChange = (s) => { lastState = s; };
  await plugin.gateway.startAccount({ credential: { token: 'bad' } });
  assert.strictEqual(lastState.status, 'error');
  assert.strictEqual(lastState.errorCode, 'AUTH_FAILED');
  assert.strictEqual(lastState.nonRecoverable, true);
});

test('T23b getMe 401 -> AUTH_FAILED; 5 network failures -> RECONNECT_EXHAUSTED', { timeout: 60000 }, async (t) => {
  // 401 on getMe
  const plugin401 = new TelegramChannel({ fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ ok: false }) }), log: () => {} });
  let st = null;
  plugin401.gateway.onConnectionStateChange = (s) => { st = s; };
  plugin401.bindCredential({ token: TOKEN });
  await plugin401.gateway.startAccount({ credential: { token: TOKEN } });
  assert.strictEqual(st.errorCode, 'AUTH_FAILED');

  // five consecutive poll failures exhaust reconnects
  const sendLog = [];
  const plugin = buildChannel({ updates: [], sendLog, failPoll: 5, delayMs: 10 });
  const states = [];
  plugin.gateway.onConnectionStateChange = (s) => states.push(s);
  plugin.bindCredential({ token: TOKEN });
  await plugin.gateway.startAccount({ credential: { token: TOKEN } });
  await new Promise((r) => setTimeout(r, 400));
  const exhausted = states.find((s) => s.errorCode === 'RECONNECT_EXHAUSTED');
  assert.ok(exhausted, 'reconnect exhaustion reached');
  assert.strictEqual(exhausted.nonRecoverable, true);
  assert.strictEqual(exhausted.reconnectAttempts, 5);
});

test('T23c ChannelManager states: needs_credentials -> configured; status table', { timeout: 30000 }, async (t) => {
  const store = new Map();
  const vault = { get: (k) => store.get(k) || null, set: (k, v) => store.set(k, v) };
  const cm = new ChannelManager({
    vault,
    engineBridge: { createSession: async () => ({ id: 's1' }), runTurn: async () => 'ok' },
    log: () => {},
  });
  let status = cm.status();
  const tg = status.find((c) => c.id === 'telegram');
  assert.ok(tg, 'telegram channel present');
  assert.strictEqual(tg.credential, 'missing');
  assert.strictEqual(tg.transport, 'long-poll');

  const r1 = await cm.start('telegram');
  assert.strictEqual(r1.state.status, 'needs_credentials');
  await cm.stop('telegram');

  await cm.setCredential('telegram', TOKEN);
  assert.strictEqual(cm.status().find((c) => c.id === 'telegram').credential, 'configured');

  // skeleton channels validate credential shape
  await cm.setCredential('slack', 'not-a-slack-token');
  const r2 = await cm.start('slack');
  assert.strictEqual(r2.state.status, 'error', 'bad slack token shape rejected');
  assert.strictEqual(r2.state.errorCode, 'AUTH_FAILED');
  await cm.stop('slack');

  await cm.setCredential('slack', 'xapp-12345-ABCDEFGH');
  const r3 = await cm.start('slack');
  assert.strictEqual(r3.state.status, 'standby', 'valid shape -> standby (manual transport)');
  await cm.stop('slack');
  await cm.dispose();
});
