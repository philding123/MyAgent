'use strict';
// Daemon app-server (F02): the long-lived business process. Electron main
// forks this; it also runs standalone under plain node for tests.

const path = require('path');
const fs = require('fs');
const { openStore } = require('./store');
const { Sandbox, defaultRules } = require('./sandbox');
const { MAX_PREVIEW_BYTES } = require('../shared/preview-kind');
const { SkillRegistry, installSkill, uninstallSkill } = require('./skills');
const { EngineHost } = require('./engine-host');
const { TerminalHost } = require('./terminal');
const { globalSearch } = require('./search');
const { CredentialVault } = require('./crypto');
const { ChannelManager } = require('./im');
const { Market } = require('./market');
const { SyncService } = require('./sync');
const { A2aServer } = require('./a2a');

const APP_VERSION = require('../../package.json').version;

/** Zip extraction via PowerShell Expand-Archive (personal-use default). */
function defaultZipExtractor() {
  return (zip, dest) => new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    if (process.platform !== 'win32') return reject(new Error('zip import only supported on windows (Phase: add unzip lib)'));
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`],
    { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
  });
}

function homeDir() {
  return process.env.MYAGENT_HOME || path.join(process.env.APPDATA || path.join(process.env.HOME || '.', '.config'), 'myagent');
}

function createDaemon({ send }) {
  const home = homeDir();
  const dataDir = path.join(home, 'data');
  const skillsBuiltin = path.join(__dirname, '..', '..', 'skills');
  const skillsUser = path.join(home, 'skills');

  const { store, warning } = openStore(dataDir);
  const vault = new CredentialVault(path.join(home, 'keystore'), null);
  const registry = new SkillRegistry([skillsBuiltin, skillsUser]);

  const emit = (topic, payload) => send({ kind: 'event', topic, payload });

  const terminalHost = new TerminalHost(emit);
  let prewarmOn = store.getSetting('engine.prewarm') === true;

  const engineHost = new EngineHost({
    emit,
    prewarm: prewarmOn,
    buildInit: (sessionId) => {
      const s = store.getSession(sessionId) || {};
      const settings = store.allSettings();
      const skills = registry.enabled().map((x) => ({ name: x.name, description: x.description, body: x.body }));
      return {
        mode: s.mode || 'craft',
        workspace: s.cwd || process.cwd(),
        sandboxRules: defaultRules(s.cwd || process.cwd()),
        llm: {
          baseUrl: settings['llm.baseUrl'] || 'http://127.0.0.1:11434/v1',
          apiKey: vault.get('llm.apiKey') || settings['llm.apiKey'] || '',
          model: settings['llm.model'] || 'local-model',
          temperature: settings['llm.temperature'],
        },
        persona: settings['persona'] || '',
        preferences: store.listMemory('preference').map((m) => m.content),
        memoryFacts: store.listMemory('fact').map((m) => m.content),
        skills,
        daemonTools: ['market'],
        cloud: settings['sandbox.backend'] === 'cloud' ? {
          enabled: true,
          apiUrl: settings['sandbox.cloud.url'] || '',
          sandboxId: settings['sandbox.cloud.sandboxId'] || '',
          apiKey: vault.get('sandbox.cloud.apiKey') || '',
        } : null,
      };
    },
    daemonToolHandler: async (tool, args) => {
      if (tool === 'market') {
        if (args.action === 'search') return { ok: true, summary: 'market search', data: { skills: await getMarket().search(args.keywords || []) } };
        if (args.action === 'install') {
          const results = await getMarket().installMany(args.names || []);
          const failed = results.filter((r) => r.status === 'refused');
          return { ok: results.some((r) => r.status === 'installed'),
            summary: results.map((r) => r.name + '=' + r.status).join(', '),
            data: { results }, refused: failed.length ? failed : undefined };
        }
        return { ok: false, summary: 'unknown market action: ' + args.action };
      }
      return { ok: false, summary: 'unknown daemon tool: ' + tool };
    },
  });

  function pipeEngine(sessionId) {
    // idempotent-ish: engine-host handles re-piping cheaply via current handle
    engineHost.pipeEvents(sessionId);
  }

  // Shared engine bridge for headless clients (F23 IM channels / F28 A2A):
  // create-or-reuse a session, run one turn, return the assistant text.
  const engineBridge = {
    createSession: (p) => store.createSession(p),
    async runTurn(sessionId, text) {
      await engineHost.start(sessionId);
      pipeEngine(sessionId);
      const h = engineHost.engines.get(sessionId);
      if (!h || !h.alive) throw new Error('engine not running');
      let reply = '';
      const offTokens = h.onEvent((ev) => { if (ev.type === 'token') reply += ev.text; });
      try {
        store.appendMessage({ session_id: sessionId, role: 'user', content: text });
        await engineHost.userMessage(sessionId, text);
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 180000);
          const off2 = h.onEvent((ev) => {
            if (ev.type === 'done' || ev.type === 'error' || ev.type === 'engine_exit') { clearTimeout(timer); off2(); resolve(); }
          });
        });
      } finally { offTokens(); }
      return reply.trim() || null;
    },
  };

  // ---- F25 cloud skill market (rebuilt when its settings change) ----
  let market = null;
  let marketSig = '';
  function getMarket() {
    const sources = String(store.getSetting('market.url') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const allowInsecure = store.getSetting('market.allowInsecure') === true;
    const sig = sources.join('|') + '#' + allowInsecure;
    if (!market || marketSig !== sig) {
      market = new Market({
        sources,
        skillsUser,
        installSkill,
        unzip: defaultZipExtractor(),
        allowInsecure,
        log: (scope, line) => store.log('info', scope, line),
      });
      marketSig = sig;
    }
    return market;
  }

  // ---- F26 session sync ----
  const sync = new SyncService({ store, emit });
  const savedSyncCfg = store.getSetting('sync.config');
  if (savedSyncCfg) sync.configure(savedSyncCfg);

  // ---- F23 IM channels ----
  const im = new ChannelManager({
    vault,
    engineBridge,
    log: (scope, line) => store.log('info', scope, line),
  });

  // ---- F28 A2A server (loopback, opt-in) ----
  let a2aServer = null;
  async function ensureA2a() {
    if (store.getSetting('a2a.enabled') !== true) return null;
    if (!a2aServer) {
      a2aServer = new A2aServer({
        port: Number(store.getSetting('a2a.port') || 41239),
        name: 'MyAgent',
        version: APP_VERSION,
        handleSend: async (text) => {
          let s = store.listSessions().find((x) => x.title === 'A2A');
          if (!s) s = await engineBridge.createSession({ title: 'A2A' });
          const reply = await engineBridge.runTurn(s.id, text);
          return reply || '(no reply)';
        },
        log: (scope, line) => store.log('info', scope, line),
      });
      await a2aServer.start();
    }
    return a2aServer;
  }
  ensureA2a().catch((e) => store.log('warn', 'a2a', 'start failed: ' + e.message));

  const methods = {
    'app.version': async () => ({ version: APP_VERSION, platform: process.platform, storeWarning: warning || null }),
    'app.selfcheck': async () => ({
      version: APP_VERSION,
      store: store.health(),
      terminal: terminalHost.status(),
      sandbox: { enabled: true, rules: defaultRules('.').file_rules.length },
      skills: { count: registry.scan().length, dirs: [skillsBuiltin, skillsUser] },
      engine: engineHost.status(),
      browser: (() => { try { return require('../shared/browser-probe').probeBrowser(); } catch (_) { return { available: false }; } })(),
      im: im.status(),
      market: getMarket().status(),
      sync: sync.status(),
      a2a: { enabled: store.getSetting('a2a.enabled') === true, url: a2aServer ? a2aServer.url : null },
      vault: { mode: vault.mode, dir: path.join(home, 'keystore') },
      dataDir,
    }),
    'sessions.list': async () => store.listSessions(),
    'sessions.create': async (p) => store.createSession(p || {}),
    'sessions.get': async (p) => {
      const s = store.getSession(p.id);
      return s ? { ...s, messages: store.listMessages(p.id) } : null;
    },
    'sessions.appendMessage': async (p) => {
      sync.noteChange(p.session_id);
      return store.appendMessage(p);
    },
    'sessions.delete': async (p) => { engineHost.stop(p.id); return store.deleteSession(p.id); },
    'sessions.rename': async (p) => store.updateSession(p.id, { title: p.title }),
    'sessions.setMode': async (p) => {
      const s = store.updateSession(p.id, { mode: p.mode });
      engineHost.stop(p.id); // next start picks up new mode
      return s;
    },
    'settings.all': async () => store.allSettings(),
    'settings.get': async (p) => store.getSetting(p.key),
    'settings.set': async (p) => {
      if (p.key === 'llm.apiKey') { vault.set('llm.apiKey', String(p.value)); store.setSetting('llm.apiKey.set', true); return true; }
      if (p.key === 'engine.prewarm') { prewarmOn = !!p.value; engineHost.opts.prewarm = prewarmOn; if (prewarmOn) engineHost.replenish(); else engineHost.stopPool(); }
      return store.setSetting(p.key, p.value);
    },
    'skills.list': async () => registry.scan().map((s) => ({ ...s, body: undefined })),
    'skills.read': async (p) => registry.read(p.name),
    'skills.toggle': async (p) => { registry.setEnabled(p.name, p.enabled); return true; },
    'skills.install': async (p) => installSkill(p.source, skillsUser, defaultZipExtractor()),
    'skills.uninstall': async (p) => uninstallSkill(p.name, skillsUser),
    'memory.add': async (p) => store.addMemory(p.kind || 'fact', p.content),
    'memory.list': async (p) => store.listMemory(p && p.kind),
    'memory.delete': async (p) => store.deleteMemory(p.id),
    // ---- F23 IM channels ----
    'im.status': async () => im.status(),
    'im.start': async (p) => im.start(p.channel),
    'im.stop': async (p) => im.stop(p.channel),
    'im.setCredential': async (p) => im.setCredential(p.channel, p.token),
    // ---- F25 cloud market ----
    'market.search': async (p) => getMarket().search(p.keywords || []),
    'market.install': async (p) => getMarket().installMany(p.names || []),
    'market.status': async () => getMarket().status(),
    // ---- F26 sync ----
    'sync.configure': async (p) => {
      const st = sync.configure(p.config);
      if (p.config) store.setSetting('sync.config', p.config);
      return st;
    },
    'sync.push': async () => sync.push(),
    'sync.pull': async () => sync.pull(),
    'sync.status': async () => sync.status(),
    // ---- F28 A2A ----
    'a2a.status': async () => ({ enabled: store.getSetting('a2a.enabled') === true, url: a2aServer ? a2aServer.url : null }),
    'a2a.enable': async (p) => {
      store.setSetting('a2a.enabled', !!p.enabled);
      if (p.enabled) { await ensureA2a(); return { ok: true, url: a2aServer.url }; }
      if (a2aServer) { await a2aServer.stop(); a2aServer = null; }
      return { ok: true, url: null };
    },
    'engine.start': async (p) => {
      const r = await engineHost.start(p.sessionId);
      pipeEngine(p.sessionId);
      return r;
    },
    'engine.stop': async (p) => engineHost.stop(p.sessionId),
    'engine.userMessage': async (p) => {
      store.appendMessage({ session_id: p.sessionId, role: 'user', content: p.text });
      await engineHost.userMessage(p.sessionId, p.text);
      return { ok: true };
    },
    'engine.confirm': async (p) => engineHost.confirm(p.id, p.approved),
    'engine.mode': async (p) => methods['sessions.setMode'](p),
    'engine.status': async () => engineHost.status(),
    'terminal.create': async (p) => terminalHost.create(p),
    'terminal.write': async (p) => terminalHost.write(p.id, p.data),
    'terminal.resize': async (p) => terminalHost.resize(p.id, p.cols, p.rows),
    'terminal.kill': async (p) => terminalHost.kill(p.id),
    'search.query': async (p) => {
      const s = store.getSession(p.sessionId);
      return globalSearch(store, p.q, (s && s.cwd) || null);
    },
    // F20 preview source: sandbox-checked binary read (credential dirs stay
    // denied by defaultRules; size capped). Returns base64 for the renderer.
    'files.readBinary': async (p) => {
      const sb = new Sandbox(defaultRules(process.cwd()), { workspace: process.cwd() });
      const chk = sb.checkFile(p.path, 'read');
      if (!chk.ok) { const e = new Error('sandbox denied: ' + chk.path); e.code = 'sandbox_denied'; throw e; }
      const stat = fs.statSync(chk.path);
      if (!stat.isFile()) { const e = new Error('not a file: ' + chk.path); e.code = 'not_file'; throw e; }
      const cap = Math.min(p.maxBytes || MAX_PREVIEW_BYTES, MAX_PREVIEW_BYTES);
      if (stat.size > cap) { const e = new Error('file too large: ' + stat.size + ' > ' + cap); e.code = 'too_large'; throw e; }
      const { mimeForExt } = require('../shared/preview-kind');
      const buf = fs.readFileSync(chk.path);
      return { mime: mimeForExt(chk.path), size: stat.size, base64: buf.toString('base64') };
    },
    'memory.test.llm': async () => {
      const settings = store.allSettings();
      const { LlmClient } = require('../engine/llm');
      const client = new LlmClient({ baseUrl: settings['llm.baseUrl'], apiKey: vault.get('llm.apiKey'), model: settings['llm.model'] });
      return client.ping();
    },
    'data.export': async () => ({
      sessions: store.listSessions(),
      settings: Object.fromEntries(Object.entries(store.allSettings()).map(([k, v]) => [k, k.includes('apiKey') ? '<redacted>' : v])),
    }),
    'data.clear': async () => {
      for (const s of store.listSessions()) store.deleteSession(s.id);
      for (const m of store.listMemory()) store.deleteMemory(m.id);
      return true;
    },
  };

  function handle(msg, cb) {
    const fn = methods[msg.method];
    if (!fn) return cb({ id: msg.id, ok: false, error: { code: 'no_method', message: 'unknown method: ' + msg.method } });
    Promise.resolve()
      .then(() => fn(msg.params || {}))
      .then((result) => cb({ id: msg.id, ok: true, result }))
      .catch((e) => cb({ id: msg.id, ok: false, error: { code: 'handler_error', message: e.message } }));
  }

  function snapshot() {
    return {
      sessions: store.listSessions(),
      settings: store.allSettings(),
      skills: registry.scan().map((s) => ({ name: s.name, description: s.description, disable: s.disable, source: s.source })),
      terminal: terminalHost.status(),
      prewarm: prewarmOn,
    };
  }

  function shutdown() {
    engineHost.stopAll();
    terminalHost.killAll();
    try { im.dispose(); } catch (_) {}
    try { if (a2aServer) a2aServer.stop(); } catch (_) {}
    try { store.checkpoint(); } catch (_) {}
    try { store.close(); } catch (_) {}
  }

  if (!fs.existsSync(skillsUser)) fs.mkdirSync(skillsUser, { recursive: true });

  return { handle, emit, snapshot, shutdown, methods, store, engineHost, terminalHost, registry, vault,
    paths: { home, dataDir, skillsBuiltin, skillsUser } };
}

module.exports = { createDaemon, homeDir, APP_VERSION };

if (require.main === module) {
  const daemon = createDaemon({ send: (m) => process.send(m) });
  process.on('message', (msg) => {
    if (!msg || msg.kind !== 'request') return;
    daemon.handle(msg, (resp) => process.send({ kind: 'response', ...resp }));
  });
  process.send({ kind: 'event', topic: 'daemon:ready', payload: daemon.snapshot() });
  process.on('disconnect', () => { daemon.shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { daemon.shutdown(); process.exit(0); });
}
