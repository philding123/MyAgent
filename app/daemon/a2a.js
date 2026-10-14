'use strict';
// A2A (Agent2Agent) minimal face (F28). Server side: this daemon exposes an
// AgentCard + JSON-RPC message/send over loopback HTTP so other agents (or a
// second MyAgent) can delegate a task. Client side: fetchAgentCard +
// sendMessage used by the engine tool agent_delegate. Minimal A2A profile:
// no streaming, no task lifecycle (design/26-sync-sandbox-a2a.md).

const http = require('http');
const crypto = require('crypto');

function agentCard({ name, description, url, version, skills }) {
  return {
    name,
    description: description || 'Personal AI agent (MyAgent)',
    url,
    version: version || '0.1.0',
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: skills || [{ id: 'chat', name: 'chat', description: 'Answer a task and return the agent reply', tags: ['chat'] }],
  };
}

/** Client: fetch an AgentCard and send one message (used by agent_delegate). */
async function delegate(url, message, { fetchImpl, timeoutMs } = {}) {
  const doFetch = fetchImpl || ((u, o) => fetch(u, o));
  const base = String(url || '').replace(/\/+$/, '');
  let cardUrl = base;
  if (!/\.well-known\/agent\.json$/.test(base)) cardUrl = base + '/.well-known/agent.json';
  const cardRes = await doFetch(cardUrl, { timeout: timeoutMs || 15000 });
  if (!cardRes.ok) throw new Error('agent card fetch failed: ' + cardRes.status);
  const card = JSON.parse(String(await cardRes.text()));
  const res = await doFetch(card.url || base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: crypto.randomUUID(), method: 'message/send',
      params: { message: { role: 'user', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: String(message) }] } },
    }),
    timeout: 120000,
  });
  if (!res.ok) throw new Error('message/send failed: ' + res.status);
  const json = JSON.parse(String(await res.text()));
  if (json.error) throw new Error('message/send error: ' + json.error.message);
  const parts = (json.result && json.result.parts) || [];
  const text = parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n');
  return { card, text };
}

class A2aServer {
  /**
   * @param opts {port, name, description, version, handleSend: async (text)=>replyText, log?}
   */
  constructor(opts) {
    this.port = Number(opts.port || 41239);
    this.opts = opts;
    this.server = null;
    this.log = opts.log || (() => {});
  }

  get url() { return 'http://127.0.0.1:' + this.port; }

  async start() {
    if (this.server) return;
    this.server = http.createServer(async (req, res) => {
      try {
        if (req.method === 'GET' && req.url === '/.well-known/agent.json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(agentCard({
            name: this.opts.name, description: this.opts.description,
            url: this.url, version: this.opts.version, skills: this.opts.skills,
          })));
          return;
        }
        if (req.method === 'POST' && req.url === '/') {
          let body = '';
          req.on('data', (c) => { body += c; if (body.length > 1024 * 512) req.destroy(); });
          req.on('end', async () => {
            let rpc;
            try { rpc = JSON.parse(body || '{}'); } catch (_) { res.writeHead(400); res.end('bad json'); return; }
            if (rpc.method !== 'message/send') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'method not found: ' + rpc.method } }));
              return;
            }
            const text = (((rpc.params || {}).message || {}).parts || [])
              .filter((p) => p.kind === 'text').map((p) => p.text).join('\n');
            try {
              const reply = await this.opts.handleSend(text);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                jsonrpc: '2.0', id: rpc.id ?? null,
                result: { role: 'agent', messageId: crypto.randomUUID(), parts: [{ kind: 'text', text: String(reply || '') }] },
              }));
            } catch (e) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32000, message: String(e.message || e) } }));
            }
          });
          return;
        }
        res.writeHead(404); res.end();
      } catch (e) {
        try { res.writeHead(500); res.end('server error'); } catch (_) {}
      }
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => { this.log('a2a', 'listening on ' + this.url); resolve(); });
    });
  }

  async stop() {
    if (this.server) { try { this.server.close(); } catch (_) {} }
    this.server = null;
  }
}

module.exports = { A2aServer, agentCard, delegate };
