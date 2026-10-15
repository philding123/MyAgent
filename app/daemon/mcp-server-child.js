'use strict';
// MCP stdio server (F34): one JSON-RPC message per stdin line, one response
// per stdout line. Runs standalone with its own store/search/skills instances
// (same MYAGENT_HOME as the daemon) so MCP clients can talk to MyAgent without
// the daemon being alive.

const readline = require('readline');
const path = require('path');
const { openStore } = require('./store');
const { globalSearch } = require('./search');
const { SkillRegistry } = require('./skills');
const { createMcpCore } = require('./mcp');

function homeDir() {
  return process.env.MYAGENT_HOME || path.join(process.env.APPDATA || path.join(process.env.HOME || '.', '.config'), 'myagent');
}

function createAdapters(home) {
  const { store } = openStore(path.join(home, 'data'));
  const registry = new SkillRegistry([path.join(__dirname, '..', '..', 'skills'), path.join(home, 'skills')]);

  const TOOLS = [
    {
      name: 'sessions_list',
      description: 'List MyAgent sessions (id, title, updatedAt)',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'session_get',
      description: 'Get one session with its messages',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'session id' } }, required: ['id'], additionalProperties: false },
    },
    {
      name: 'search_query',
      description: 'Search across sessions and workspace files',
      inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'query text' } }, required: ['q'], additionalProperties: false },
    },
    {
      name: 'skills_list',
      description: 'List installed MyAgent skills',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];

  async function callTool(name, args) {
    switch (name) {
      case 'sessions_list':
        return store.listSessions().map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }));
      case 'session_get': {
        const s = store.getSession(args.id);
        if (!s) throw new Error('session not found: ' + args.id);
        return s;
      }
      case 'search_query':
        return globalSearch(store, String(args.q || ''), path.join(home, 'workspace'));
      case 'skills_list':
        return registry.scan().map((s) => ({ name: s.name, description: s.description, enabled: s.enabled !== false }));
      default:
        throw new Error('unknown tool ' + name);
    }
  }

  async function resources() {
    return store.listSessions().map((s) => ({
      uri: 'myagent://sessions/' + s.id,
      name: s.title,
      description: 'MyAgent session ' + s.id,
      mimeType: 'application/json',
    }));
  }

  async function readResource(uri) {
    const m = /^myagent:\/\/sessions\/([a-zA-Z0-9-]+)$/.exec(uri);
    if (!m) return undefined;
    const s = store.getSession(m[1]);
    return s || undefined;
  }

  return { tools: TOOLS, callTool, resources, readResource };
}

module.exports = { createAdapters, homeDir };

if (require.main === module) {
  const core = createMcpCore({ name: 'myagent', version: '1.0.0', ...createAdapters(homeDir()) });
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try { msg = JSON.parse(text); } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    core.handle(msg).then((out) => {
      if (out) process.stdout.write(JSON.stringify(out) + '\n');
    });
  });
  rl.on('close', () => process.exit(0));
}
