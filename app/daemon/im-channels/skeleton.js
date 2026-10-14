'use strict';
// Skeleton channel adapters (F23) for platforms with public protocols whose
// real-token wiring is a documented manual step (design/23-im-channels.md):
// slack (socket-mode WS), discord (gateway WS), dingtalk (stream), feishu
// (WS long-connection). They implement credential validation and the full
// connection state machine without opening network connections.

class SkeletonChannel {
  constructor(id, env = {}) {
    const meta = {
      slack: { displayName: 'Slack Bot', transport: 'socket-mode', docs: 'https://api.slack.com/apis/connections/socket-mode' },
      discord: { displayName: 'Discord Bot', transport: 'gateway-ws', docs: 'https://discord.com/developers/docs/topics/gateway' },
      dingtalk: { displayName: '钉钉机器人', transport: 'stream', docs: 'https://open.dingtalk.com/document/orgapp-stream' },
      feishu: { displayName: '飞书机器人', transport: 'ws-long', docs: 'https://open.feishu.cn/document/client-docs/bot-v3/long-connection-mode' },
    }[id];
    this.id = id;
    this.meta = meta;
    this.capabilities = { sendText: true, sendMarkdown: true, sendMedia: false, interactive: false, streaming: false, groupChat: true, threading: false };
    this.defaultReplyPolicy = { mode: 'direct' };
    this.log = env.log || (() => {});
    this.gateway = new SkeletonGateway(id, meta.transport, this.log);
    this.outbound = new SkeletonOutbound(id, meta.transport);
  }

  /** token shape validation per platform (config-level; no network). */
  static validateCredential(id, cred) {
    const token = String((cred && cred.token) || '');
    if (!token) return { ok: false, reason: 'empty token' };
    switch (id) {
      case 'slack': return /^xapp-\d+-[A-Za-z0-9-]+$/.test(token) ? { ok: true } : { ok: false, reason: 'slack app-level token must look like xapp-...' };
      case 'discord': return /^[A-Za-z0-9._-]{50,}$/.test(token) ? { ok: true } : { ok: false, reason: 'discord bot token format mismatch' };
      case 'dingtalk': return /^[A-Za-z0-9]{8,}$/.test(token) ? { ok: true } : { ok: false, reason: 'dingtalk appKey/appSecret pair expected (store appSecret here)' };
      case 'feishu': return /^[a-z0-9]{16,}$/i.test(token) ? { ok: true } : { ok: false, reason: 'feishu app secret format mismatch' };
      default: return { ok: true };
    }
  }

  bindCredential(cred) {
    const v = SkeletonChannel.validateCredential(this.id, cred);
    this.gateway.credentialCheck = v;
  }
}

class SkeletonGateway {
  constructor(id, transport, log) {
    this.id = id;
    this.transport = transport;
    this.log = log;
    this.credentialCheck = null;
    this.connectionState = { status: 'disconnected' };
    this.onInboundMessage = null;
    this.onConnectionStateChange = null;
    this.account = null;
  }

  setState(s) {
    this.connectionState = s;
    if (this.onConnectionStateChange) this.onConnectionStateChange(s);
  }

  async startAccount(account) {
    this.account = account;
    const v = this.credentialCheck || SkeletonChannel.validateCredential(this.id, account.credential);
    if (!v.ok) {
      this.setState({ status: 'error', error: v.reason, errorCode: 'AUTH_FAILED', nonRecoverable: true });
      return;
    }
    // Real transport (WS long-connection) intentionally not opened by default:
    // unattended runs must not hold live bot sessions. Manual step documented.
    this.setState({ status: 'standby', error: 'credential valid; start real transport manually (see docs: ' + this.transport + ')' });
  }

  async stopAccount() {
    this.account = null;
    this.setState({ status: 'disconnected' });
  }
}

class SkeletonOutbound {
  constructor(id, transport) {
    this.id = id;
    this.transport = transport;
  }
  async send() {
    return { success: false, error: this.id + ' outbound requires live transport (manual token step)' };
  }
}

module.exports = { SkeletonChannel, SkeletonGateway, SkeletonOutbound };
