'use strict';
// Generic inbound-webhook channel (F23): a loopback HTTP service any platform
// can post to (shared-secret header), personal fallback for closed platforms.

const http = require('http');

class WebhookChannel {
  constructor(env = {}) {
    this.id = 'webhook';
    this.meta = { displayName: 'Generic Webhook', transport: 'http-inbound' };
    this.capabilities = { sendText: true, sendMarkdown: false, sendMedia: false, interactive: false, streaming: false, groupChat: true, threading: false };
    this.defaultReplyPolicy = { mode: 'all' };
    this.port = Number(env.port || process.env.MYAGENT_WEBHOOK_PORT || 41238);
    this.secret = env.secret || '';
    this.log = env.log || (() => {});
    this.gateway = new WebhookGateway({ port: this.port, secret: this.secret, log: this.log });
    this.outbound = { send: async (msg) => ({ success: false, error: 'webhook channel has no outbound (responses go via engine sessions)' }) };
  }
  bindCredential() {}
}

class WebhookGateway {
  constructor({ port, secret, log }) {
    this.port = port;
    this.secret = secret;
    this.log = log;
    this.server = null;
    this.onInboundMessage = null;
    this.connectionState = { status: 'disconnected' };
  }

  setState(s) { this.connectionState = s; }

  async startAccount() {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      if (this.secret && req.headers['x-myagent-secret'] !== this.secret) {
        res.writeHead(401); res.end('bad secret'); return;
      }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1024 * 512) req.destroy(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const messageId = String(parsed.messageId || ('wh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)));
          if (this.onInboundMessage) {
            this.onInboundMessage({
              messageId,
              content: [{ type: 'text', text: String(parsed.text || '') }],
              sender: { senderId: String(parsed.senderId || 'webhook'), senderName: parsed.senderName || 'webhook' },
              group: parsed.groupId ? { groupId: String(parsed.groupId), groupName: parsed.groupName, chatType: 'group' } : undefined,
              timestamp: new Date().toISOString(),
              replyContext: { chatId: parsed.chatId || parsed.senderId || 'webhook', messageId: 0 },
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400); res.end('bad json');
        }
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        this.log('im', `[webhook] listening on 127.0.0.1:${this.port}`);
        this.setState({ status: 'connected', connectedAt: Date.now() });
        resolve();
      });
    });
  }

  async stopAccount() {
    if (this.server) { try { this.server.close(); } catch (_) {} }
    this.server = null;
    this.setState({ status: 'disconnected' });
  }
}

module.exports = { WebhookChannel, WebhookGateway };
