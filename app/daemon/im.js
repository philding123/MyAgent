'use strict';
// IM channel framework (F23). Contract copied from WorkBuddy main/telegram.js
// evidence: plugin = {id, meta, capabilities, gateway, outbound, defaultReply-
// Policy}; inbound message = {messageId, content[], sender, group?, timestamp,
// replyContext}; 500-entry ring dedup (recordMsgId); long-poll gateway with
// offset + reconnect-exhaustion semantics.

const { TelegramChannel } = require('./im-channels/telegram');
const { WebhookChannel } = require('./im-channels/webhook');
const { SkeletonChannel } = require('./im-channels/skeleton');

const DEDUP_CAP = 500;

/** Ring buffer message-id dedup (WorkBuddy recordMsgId, capacity 500). */
class RingDedup {
  constructor(cap = DEDUP_CAP) {
    this.cap = cap;
    this.buf = new Map(); // id -> true (insertion-ordered)
  }
  seen(id) {
    if (this.buf.has(id)) return true;
    if (this.buf.size >= this.cap) this.buf.delete(this.buf.keys().next().value);
    this.buf.set(id, true);
    return false;
  }
  get size() { return this.buf.size; }
}

/** Framework for one channel: dedup + gateway lifecycle + reply routing. */
class ChannelHandle {
  constructor(plugin, { log, credentials, onInbound }) {
    this.plugin = plugin;
    this.log = log;
    this.credentials = credentials; // () => ({token, ...} | null) from vault
    this.onInbound = onInbound; // (channelId, inboundMsg)
    this.dedup = new RingDedup();
    this.gateway = null;
    this.outbound = null;
    this.state = { status: 'disabled', reason: null, reconnectAttempts: 0 };
  }

  hasCredential() {
    const c = this.credentials();
    return !!(c && (c.token || c.secret || c.appSecret));
  }

  async start() {
    if (this.gateway) return this.state;
    const cred = this.credentials();
    if (!cred) {
      this.state = { status: 'needs_credentials', reason: 'no credential configured', reconnectAttempts: 0 };
      return this.state;
    }
    if (this.plugin.bindCredential) this.plugin.bindCredential(cred);
    this.outbound = this.plugin.outbound;
    this.gateway = this.plugin.gateway;
    this.gateway.onInboundMessage = (msg) => this.handleInbound(msg);
    this.gateway.onConnectionStateChange = (s) => {
      this.state = { ...this.state, ...s };
      this.log('im', this.plugin.id + ' state: ' + s.status);
    };
    await this.gateway.startAccount({
      credential: { ...cred },
      displayName: this.plugin.meta.displayName,
    });
    return this.state;
  }

  async stop() {
    if (this.gateway) { try { await this.gateway.stopAccount(); } catch (_) {} }
    this.gateway = null;
    this.outbound = null;
    this.state = { status: 'disabled', reason: null, reconnectAttempts: 0 };
  }

  handleInbound(msg) {
    if (!msg || !msg.messageId) return;
    if (this.dedup.seen(String(msg.messageId))) return;
    const policy = this.plugin.defaultReplyPolicy || { mode: 'all' };
    if (policy.mode === 'direct' && msg.group) return;
    this.onInbound(this.plugin.id, msg);
  }

  async send(text, replyContext, deliveryMode = 'final') {
    if (!this.outbound) return { success: false, error: 'channel not started' };
    return this.outbound.send({ deliveryMode, text, replyContext });
  }

  describe() {
    return {
      id: this.plugin.id,
      displayName: this.plugin.meta.displayName,
      transport: this.plugin.meta.transport,
      capabilities: this.plugin.capabilities,
      replyPolicy: (this.plugin.defaultReplyPolicy || {}).mode || 'all',
      credential: this.hasCredential() ? 'configured' : 'missing',
      ...this.state,
    };
  }
}

const SKELETON_IDS = ['slack', 'discord', 'dingtalk', 'feishu'];

class ChannelManager {
  constructor({ vault, engineBridge, log }) {
    this.vault = vault; // CredentialVault instance
    this.engineBridge = engineBridge; // async (inbound, channel) => replyText
    this.log = log || (() => {});
    this.handles = new Map();
    this.sessions = new Map(); // channel:chatId -> sessionId
    this.buildPlugins();
  }

  credentialsFor(channelId) {
    return () => {
      const raw = this.vault.get('im.' + channelId + '.token');
      if (!raw) return null;
      return channelId === 'telegram' ? { token: raw } : { token: raw };
    };
  }

  buildPlugins() {
    const env = { log: this.log };
    const defs = [
      new TelegramChannel(env),
      new WebhookChannel(env),
      ...SKELETON_IDS.map((id) => new SkeletonChannel(id, env)),
    ];
    for (const plugin of defs) {
      this.handles.set(plugin.id, new ChannelHandle(plugin, {
        log: this.log,
        credentials: this.credentialsFor(plugin.id),
        onInbound: (channelId, msg) => this.routeInbound(channelId, msg),
      }));
    }
  }

  chatKey(channelId, msg) {
    const chatId = (msg.replyContext && msg.replyContext.chatId) || (msg.sender && msg.sender.senderId) || 'unknown';
    return channelId + ':' + String(chatId);
  }

  async routeInbound(channelId, msg) {
    try {
      const text = (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (!text) return;
      const key = this.chatKey(channelId, msg);
      let sessionId = this.sessions.get(key);
      if (!sessionId) {
        const s = await this.engineBridge.createSession({ title: 'IM/' + channelId + '/' + key.split(':')[1] });
        sessionId = s.id;
        this.sessions.set(key, sessionId);
      }
      const reply = await this.engineBridge.runTurn(sessionId, text);
      const handle = this.handles.get(channelId);
      if (handle && reply) await handle.send(reply, msg.replyContext, 'final');
    } catch (e) {
      this.log('im', 'routeInbound failed: ' + e.message);
    }
  }

  async start(channelId) {
    const h = this.handles.get(channelId);
    if (!h) return { ok: false, reason: 'unknown channel' };
    await h.start();
    return { ok: true, state: h.state };
  }

  async stop(channelId) {
    const h = this.handles.get(channelId);
    if (!h) return { ok: false, reason: 'unknown channel' };
    await h.stop();
    return { ok: true };
  }

  async setCredential(channelId, token) {
    if (!this.handles.has(channelId)) return { ok: false, reason: 'unknown channel' };
    this.vault.set('im.' + channelId + '.token', String(token));
    return { ok: true };
  }

  status() {
    return [...this.handles.values()].map((h) => h.describe());
  }

  async dispose() {
    for (const h of this.handles.values()) await h.stop();
  }
}

module.exports = { ChannelManager, RingDedup, ChannelHandle, SKELETON_IDS, DEDUP_CAP };
