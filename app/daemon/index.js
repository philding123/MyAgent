'use strict';
// Daemon app-server (F02): the long-lived business process. Electron main
// forks this; it also runs standalone under plain node for tests.

const path = require('path');
const fs = require('fs');
const { openStore } = require('./store');
const { Sandbox, defaultRules } = require('./sandbox');
const { SkillRegistry, installSkill, uninstallSkill } = require('./skills');
const { EngineHost } = require('./engine-host');
const { TerminalHost } = require('./terminal');
const { globalSearch } = require('./search');
const { CredentialVault } = require('./crypto');

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
      };
    },
  });

  function pipeEngine(sessionId) {
    // idempotent-ish: engine-host handles re-piping cheaply via current handle
    engineHost.pipeEvents(sessionId);
  }

  const methods = {
    'app.version': async () => ({ version: APP_VERSION, platform: process.platform, storeWarning: warning || null }),
    'app.selfcheck': async () => ({
      version: APP_VERSION,
      store: store.health(),
      terminal: terminalHost.status(),
      sandbox: { enabled: true, rules: defaultRules('.').file_rules.length },
      skills: { count: registry.scan().length, dirs: [skillsBuiltin, skillsUser] },
      engine: engineHost.status(),
      vault: { mode: vault.mode, dir: path.join(home, 'keystore') },
      dataDir,
    }),
    'sessions.list': async () => store.listSessions(),
    'sessions.create': async (p) => store.createSession(p || {}),
    'sessions.get': async (p) => {
      const s = store.getSession(p.id);
      return s ? { ...s, messages: store.listMessages(p.id) } : null;
    },
    'sessions.appendMessage': async (p) => store.appendMessage(p),
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
