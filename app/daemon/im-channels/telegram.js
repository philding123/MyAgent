'use strict';
// Telegram long-poll channel (F23). Faithful re-implementation of the
// WorkBuddy main/telegram.js contract (evidence in design/23-im-channels.md):
// getMe validation, getUpdates offset tracking, 5-failure reconnect
// exhaustion, HTML 4000-char chunked outbound with plain-text fallback.

const TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;
const LONG_POLL_TIMEOUT_S = 30;
const MAX_RECONNECT = 5;
const DEFAULT_RECONNECT_DELAY_MS = 5000;
const CHUNK_LIMIT = 4000;
const HARD_LIMIT = 4096;

function isValidToken(token) { return TOKEN_RE.test(String(token || '')); }

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimal markdown -> Telegram HTML (headings, bold, italic, code, links, bullets). */
function markdownToTelegramHtml(md) {
  const lines = String(md || '').split('\n');
  const out = [];
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) { out.push('<b>' + inline(h[2]) + '</b>'); continue; }
    if (/^[-*_]{3,}\s*$/.test(line)) { out.push('———'); continue; }
    const ul = line.match(/^(\s*)[*\-+]\s+(.*)/);
    if (ul) { out.push(ul[1] + '• ' + inline(ul[2])); continue; }
    out.push(inline(line));
  }
  return out.join('\n');

  function inline(s) {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }
}

/** Tag-aware split of an HTML string into <=limit chunks (no tag cut in half). */
function splitHtml(html, limit = CHUNK_LIMIT) {
  if (html.length <= limit) return [html];
  const parts = [];
  let cur = '';
  const openTags = [];
  // reserve room for the closing tags we must append at every flush
  const reserve = () => openTags.length * 16 + 8;
  const room = () => limit - cur.length - reserve();
  const flush = () => {
    parts.push(cur + [...openTags].reverse().map((t) => '</' + t + '>').join(''));
    cur = openTags.map((t) => '<' + t + '>').join('');
  };
  const emitText = (text) => {
    let i = 0;
    while (i < text.length) {
      if (room() <= 1) flush();
      const take = Math.max(1, Math.min(text.length - i, room() - 1));
      cur += text.slice(i, i + take);
      i += take;
    }
  };
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?>/g;
  let pos = 0;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    emitText(html.slice(pos, m.index));
    const tag = m[0];
    if (cur.length + tag.length + reserve() > limit) flush();
    if (tag.startsWith('</')) {
      const idx = openTags.lastIndexOf(m[1].toLowerCase());
      if (idx >= 0) openTags.splice(idx, 1);
    } else if (!tag.trimEnd().endsWith('/>')) {
      openTags.push(m[1].toLowerCase());
    }
    cur += tag;
    pos = m.index + tag.length;
  }
  emitText(html.slice(pos));
  const tail = cur + [...openTags].reverse().map((t) => '</' + t + '>').join('');
  if (tail.trim()) parts.push(tail);
  return parts.filter((p) => p.length);
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

class TelegramChannel {
  constructor(env = {}) {
    this.id = 'telegram';
    this.meta = { displayName: 'Telegram Bot', transport: 'long-poll' };
    this.capabilities = { sendText: true, sendMarkdown: true, sendMedia: true, interactive: false, streaming: false, groupChat: true, threading: false };
    this.defaultReplyPolicy = { mode: 'all' };
    this.fetchImpl = env.fetchImpl || ((u, o) => fetch(u, o));
    this.log = env.log || (() => {});
    this.apiBase = env.apiBase || 'https://api.telegram.org';
    // gateway/outbound bound at startAccount time by the framework
    this.gateway = new TelegramGateway({ fetchImpl: this.fetchImpl, apiBase: this.apiBase, log: this.log });
    this.outbound = new TelegramOutbound({ fetchImpl: this.fetchImpl, apiBase: this.apiBase, log: this.log, getCredentials: () => this._cred || null });
  }

  /** framework calls this to arm credential-dependent senders */
  bindCredential(cred) { this._cred = cred; this.gateway._cred = cred; }
}

class TelegramGateway {
  constructor({ fetchImpl, apiBase, log, delayMs }) {
    this.fetchImpl = fetchImpl;
    this.apiBase = apiBase;
    this.log = log;
    this.delayMs = delayMs || DEFAULT_RECONNECT_DELAY_MS;
    this.pollRunning = false;
    this.reconnectAttempts = 0;
    this.pollOffset = 0;
    this.connectionState = { status: 'disconnected' };
    this.onInboundMessage = null;
    this.onConnectionStateChange = null;
    this.account = null;
    this.abortController = null;
    this._cred = null;
  }

  setState(s) { this.connectionState = s; if (this.onConnectionStateChange) this.onConnectionStateChange(s); }

  async startAccount(account) {
    this.account = account;
    this._cred = account.credential;
    this.reconnectAttempts = 0;
    this.pollOffset = 0;
    if (!isValidToken(account.credential.token)) {
      this.setState({ status: 'error', error: 'Token invalid or expired', errorCode: 'AUTH_FAILED', nonRecoverable: true });
      return;
    }
    try {
      const res = await this.fetchImpl(`${this.apiBase}/bot${account.credential.token}/getMe`);
      const json = await res.json();
      if (!json.ok || !json.result) {
        this.setState({ status: 'error', error: 'Token invalid or expired', errorCode: 'AUTH_FAILED', nonRecoverable: true });
        return;
      }
      this.log('im', `[Telegram] getMe ok: ${json.result.username}`);
    } catch (e) {
      this.setState({ status: 'error', error: e.message || 'Network error', errorCode: 'NETWORK' });
      return;
    }
    this.setState({ status: 'connected', connectedAt: Date.now() });
    this.startPolling();
  }

  async stopAccount() {
    this.pollRunning = false;
    if (this.abortController) this.abortController.abort();
    this.account = null;
    this.pollOffset = 0;
    this.setState({ status: 'disconnected' });
  }

  startPolling() {
    if (this.pollRunning) return;
    this.pollRunning = true;
    this.poll().catch(() => {});
  }

  async poll() {
    while (this.pollRunning && this.account) {
      const url = `${this.apiBase}/bot${this._cred.token}/getUpdates?timeout=${LONG_POLL_TIMEOUT_S}&offset=${this.pollOffset}`;
      this.abortController = new AbortController();
      try {
        const res = await this.fetchImpl(url, { signal: this.abortController.signal });
        const json = await res.json();
        if (!json.ok) {
          if (res.status === 401) {
            this.setState({ status: 'error', error: 'Credentials expired, please reconfigure', errorCode: 'AUTH_FAILED', nonRecoverable: true });
            this.pollRunning = false;
            return;
          }
          throw new Error(json.description || 'getUpdates failed');
        }
        this.reconnectAttempts = 0;
        if (this.connectionState.status !== 'connected') {
          this.setState({ status: 'connected', connectedAt: Date.now() });
        }
        for (const update of json.result || []) {
          this.pollOffset = update.update_id + 1;
          this.handleUpdate(update);
        }
        // Real long-poll holds the connection ~30s; when the transport returns
        // instantly (mock/fast failover) sleep a beat to avoid a busy loop.
        if (!(json.result || []).length) {
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e) {
        if (e && e.name === 'AbortError') {
          if (this.pollRunning) continue;
          break;
        }
        this.log('im', '[Telegram] poll error: ' + (e.message || e));
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= MAX_RECONNECT) {
          this.setState({ status: 'error', error: 'Disconnected after 5 consecutive failures', errorCode: 'RECONNECT_EXHAUSTED', nonRecoverable: true, reconnectAttempts: this.reconnectAttempts });
          this.pollRunning = false;
          return;
        }
        this.setState({ status: 'connecting', reconnectAttempts: this.reconnectAttempts });
        await new Promise((r) => setTimeout(r, this.delayMs));
      }
    }
  }

  handleUpdate(update) {
    if (!update.message) return;
    const m = update.message;
    if (m.text || m.photo || m.document) {
      const content = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      if (m.caption) content.push({ type: 'text', text: m.caption });
      if (content.length) {
        if (this.onInboundMessage) {
          this.onInboundMessage({
            messageId: String(m.message_id),
            content,
            sender: { senderId: String((m.from && m.from.id) ?? 'unknown'), senderName: m.from && (m.from.first_name || m.from.username) },
            group: m.chat.type === 'private' ? undefined : { groupId: String(m.chat.id), groupName: m.chat.title, chatType: m.chat.type },
            timestamp: new Date(m.date * 1000).toISOString(),
            replyContext: { chatId: m.chat.id, messageId: m.message_id },
          });
        }
      }
    }
  }
}

class TelegramOutbound {
  constructor({ fetchImpl, apiBase, log, getCredentials }) {
    this.fetchImpl = fetchImpl;
    this.apiBase = apiBase;
    this.log = log;
    this.getCredentials = getCredentials;
  }

  async send(msg) {
    if (msg.deliveryMode !== 'final' && msg.deliveryMode !== 'progress') return { success: true };
    const cred = this.getCredentials();
    if (!cred) return { success: false, error: 'No credentials available' };
    const chatId = msg.replyContext && msg.replyContext.chatId;
    if (!chatId) return { success: false, error: 'Missing chatId in replyContext' };
    try {
      if (msg.deliveryMode === 'progress') {
        const res = await this.fetchImpl(`${this.apiBase}/bot${cred.token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg.text }),
        });
        return res.ok ? { success: true } : { success: false, error: 'Telegram API error: ' + res.status };
      }
      const chunks = splitHtml(markdownToTelegramHtml(msg.text), CHUNK_LIMIT);
      for (const chunk of chunks) {
        const asHtml = chunk.length <= HARD_LIMIT;
        const body = asHtml
          ? { chat_id: chatId, text: chunk, parse_mode: 'HTML' }
          : { chat_id: chatId, text: stripHtml(chunk) };
        let res = await this.fetchImpl(`${this.apiBase}/bot${cred.token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!res.ok && asHtml && res.status === 400) {
          this.log('im', '[Telegram] HTML send failed, retrying as plain text');
          res = await this.fetchImpl(`${this.apiBase}/bot${cred.token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: stripHtml(chunk) }),
          });
        }
        if (!res.ok) return { success: false, error: 'Telegram API error: ' + res.status };
      }
      return { success: true };
    } catch (e) {
      this.log('im', '[Telegram] send failed: ' + (e.message || e));
      return { success: false, error: e.message || 'send failed' };
    }
  }
}

module.exports = { TelegramChannel, isValidToken, markdownToTelegramHtml, splitHtml, stripHtml, TOKEN_RE };
