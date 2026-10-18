'use strict';
// MCP client / connectors (F52, wb「专家·技能·连接器」). wb's connector surface
// is MCP integration (evidence: ~/.workbuddy/mcp-tool-list.json entries like
// workbuddy_cloudservice_db_list_tools) — MyAgent had only the MCP SERVER side
// (F34). One stdio MCP server process per connector; its tools are flattened
// into engine tool defs (mcp_<connector>_<tool>) and calls ride the existing
// daemon_tool bridge. Connectors live in store settings (connectors key).

const { spawn } = require('child_process');
const { PROTOCOL_VERSION } = require('./mcp');

const INIT_TIMEOUT_MS = 15000;
const CALL_TIMEOUT_MS = 60000;

class McpConnector {
  constructor(cfg, log) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.command = cfg.command;
    this.args = cfg.args || [];
    this.env = cfg.env || {};
    this.enabled = cfg.enabled !== false;
    this.log = log || (() => {});
    this.child = null;
    this.tools = [];
    this.pending = new Map();
    this.seq = 0;
    this.state = 'stopped';
    this.error = null;
  }

  start() {
    if (this.child) return Promise.resolve(this.tools);
    this.state = 'starting';
    this.error = null;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(() => {
        this.state = 'error'; this.error = 'init timeout';
        finish(reject, new Error('mcp connector init timeout: ' + this.name));
      }, INIT_TIMEOUT_MS);
      try {
        this.child = spawn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...this.env },
          windowsHide: true,
        });
      } catch (e) {
        this.state = 'error'; this.error = e.message;
        return finish(reject, e);
      }
      let buf = '';
      this.child.stdout.on('data', (d) => {
        buf += String(d);
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch (_) { continue; }
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            p(msg);
          }
        }
      });
      this.child.stderr.on('data', (d) => this.log('mcp:' + this.name, String(d).slice(0, 300)));
      this.child.on('exit', (code) => {
        this.state = 'stopped';
        this.error = code == null ? 'terminated' : 'exit ' + code;
        this.tools = [];
        for (const p of this.pending.values()) p({ error: { code: -1, message: 'connector exited' } });
        this.pending.clear();
        this.child = null;
      });
      this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'myagent', version: '0.1.0' },
      })
        .then(() => {
          this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          return this.request('tools/list', {});
        })
        .then((res) => {
          this.tools = ((res && res.tools) || []).map((t) => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || { type: 'object', properties: {} },
          }));
          this.state = 'connected';
          finish(resolve, this.tools);
        })
        .catch((e) => {
          this.state = 'error';
          this.error = e.message;
          finish(reject, e);
        });
    });
  }

  send(msg) {
    try { this.child.stdin.write(JSON.stringify(msg) + '\n'); } catch (_) {}
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new Error('connector not running: ' + this.name));
      const id = 'r' + (++this.seq);
      this.pending.set(id, (res) => (res.error ? reject(new Error(res.error.message || 'mcp error')) : resolve(res.result)));
      this.send({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('mcp request timeout: ' + method));
        }
      }, CALL_TIMEOUT_MS);
    });
  }

  async callTool(name, args) {
    if (this.state !== 'connected' || !this.child) await this.start();
    const res = await this.request('tools/call', { name, arguments: args || {} });
    return ((res && res.content) || []).map((c) => c.text || '').join('\n');
  }

  stop() {
    if (this.child) { try { this.child.kill(); } catch (_) {} this.child = null; }
    this.state = 'stopped';
    this.tools = [];
  }
}

class McpConnectorManager {
  constructor({ store, log }) {
    this.store = store;
    this.log = log || (() => {});
    this.conns = new Map();
  }

  list() {
    const l = this.store.getSetting('connectors');
    return Array.isArray(l) ? l : [];
  }

  save(l) { this.store.setSetting('connectors', l); }

  /** Start every enabled connector; per-connector failures never throw. */
  async ensureStarted() {
    for (const cfg of this.list()) {
      if (cfg.enabled === false) continue;
      const c = this.get(cfg.id);
      if (c && c.state !== 'connected') c.start().catch(() => {});
    }
  }

  get(id) {
    if (this.conns.has(id)) return this.conns.get(id);
    const cfg = this.list().find((c) => c.id === id);
    if (!cfg) return null;
    const c = new McpConnector(cfg, this.log);
    this.conns.set(id, c);
    return c;
  }

  add({ name, command, args, env, enabled }) {
    if (!name || !command) throw new Error('connector needs name and command');
    const l = this.list();
    if (l.some((c) => c.name === name)) throw new Error('connector already installed: ' + name);
    const cfg = { id: 'conn_' + Date.now().toString(36), name, command,
      args: Array.isArray(args) ? args : [], env: env && typeof env === 'object' ? env : {},
      enabled: enabled !== false };
    l.push(cfg);
    this.save(l);
    if (cfg.enabled) this.get(cfg.id).start().catch(() => {});
    return cfg;
  }

  remove(id) {
    const c = this.conns.get(id);
    if (c) { c.stop(); this.conns.delete(id); }
    this.save(this.list().filter((c2) => c2.id !== id));
    return true;
  }

  toggle(id, enabled) {
    const l = this.list();
    const cfg = l.find((c) => c.id === id);
    if (!cfg) throw new Error('unknown connector: ' + id);
    cfg.enabled = !!enabled;
    this.save(l);
    const c = this.get(id);
    if (cfg.enabled) c.start().catch(() => {});
    else c.stop();
    return cfg;
  }

  catalog() {
    return this.list().map((cfg) => {
      const c = this.get(cfg.id);
      return { ...cfg, state: c ? c.state : 'stopped', error: c ? c.error : null,
        tools: c && c.state === 'connected' ? c.tools : [] };
    });
  }

  status() {
    const cat = this.catalog();
    return { count: cat.length, connected: cat.filter((c) => c.state === 'connected').length,
      tools: cat.reduce((n, c) => n + c.tools.length, 0) };
  }

  sanitize(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'conn'; }

  /** Engine tool defs: mcp_<connector>_<tool> for every connected connector. */
  engineToolDefs() {
    const defs = [];
    for (const cat of this.catalog()) {
      if (cat.state !== 'connected') continue;
      const server = this.sanitize(cat.name);
      for (const t of cat.tools) {
        defs.push({
          name: 'mcp_' + server + '_' + this.sanitize(t.name),
          description: '[' + cat.name + ' connector] ' + (t.description || t.name),
          inputSchema: t.inputSchema,
          server: cat.name,
          tool: t.name,
        });
      }
    }
    return defs;
  }

  async call(server, tool, args) {
    const cat = this.catalog().find((c) => c.name === server || this.sanitize(c.name) === server);
    if (!cat) throw new Error('unknown connector: ' + server);
    const c = this.get(cat.id);
    return c.callTool(tool, args);
  }
}

module.exports = { McpConnectorManager, McpConnector };
