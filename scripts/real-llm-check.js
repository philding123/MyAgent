'use strict';
// Real-LLM acceptance check (completes the manual spot-check items in
// 99-test-plan.md). Reads the OpenAI-compatible endpoint config from
// ~/.codex/{config.toml,auth.json}, writes it through the daemon RPC
// (API key into the encrypted vault), then runs two live tasks:
//   R1 craft mode: agent must create + read back a file (tool loop)
//   R2 ask mode:   agent must refuse to write (policy, no file)
// Usage: node scripts/real-llm-check.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { forkDaemon, makeTempHome } = require('../tests/helpers');

function readCodexConfig() {
  const home = path.join(os.homedir(), '.codex');
  const auth = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'));
  const key = auth.OPENAI_API_KEY;
  if (!key) throw new Error('no OPENAI_API_KEY in ~/.codex/auth.json');
  let baseUrl = 'https://api.openai.com/v1';
  const toml = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
  const m = /\[model_providers\.OpenAI\][^[]*?base_url\s*=\s*"([^"]+)"/s.exec(toml);
  if (m) baseUrl = m[1];
  return { baseUrl, key, model: 'gpt-6.1-sol' };
}

const mask = (s) => String(s).slice(0, 6) + '...' + String(s).slice(-4);

(async () => {
  const cfg = readCodexConfig();
  console.log('endpoint:', cfg.baseUrl, 'model:', cfg.model, 'key:', mask(cfg.key));

  // real user home (no MYAGENT_HOME override) — this is the app's own config
  delete process.env.MYAGENT_HOME;
  const realHome = process.env.APPDATA ? path.join(process.env.APPDATA, 'myagent') : path.join(os.homedir(), '.config', 'myagent');
  const d = forkDaemon(realHome);
  const results = { endpoint: cfg.baseUrl, model: cfg.model, checks: [] };
  const check = (name, ok, detail) => {
    results.checks.push({ name, ok, detail });
    console.log(ok ? 'PASS' : 'FAIL', '-', name, detail ? '(' + detail + ')' : '');
  };

  try {
    // configure through the real RPC path (key lands in the encrypted vault)
    await d.request('settings.set', { key: 'llm.baseUrl', value: cfg.baseUrl });
    await d.request('settings.set', { key: 'llm.apiKey', value: cfg.key });
    await d.request('settings.set', { key: 'llm.model', value: cfg.model });
    // vault must not leak plaintext
    const vaultFile = path.join(realHome, 'keystore', 'vault.bin');
    check('R0a key stored encrypted', fs.existsSync(vaultFile) && !fs.readFileSync(vaultFile, 'utf8').includes(cfg.key));

    // R0b test connection through MyAgent's own client
    const ping = await d.request('memory.test.llm');
    check('R0b test connection', ping.ok && !!ping.result && ping.result.ok, ping.ok ? String(ping.result.reply).slice(0, 40) : ping.error && ping.error.message);

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-real-'));
    const collect = (sessionId, marker, timeoutMs) => new Promise((resolve, reject) => {
      const events = [];
      const t = setTimeout(() => reject(new Error('real-llm turn timeout')), timeoutMs || 180000);
      let seen = d.events.length;
      const timer = setInterval(() => {
        while (seen < d.events.length) {
          const ev = d.events[seen++];
          if (ev.topic !== 'engine:' + sessionId) continue;
          events.push(ev.payload);
          if (ev.payload.type === 'done' || ev.payload.type === 'error') { clearInterval(t2); clearTimeout(t); resolve(events); }
        }
      }, 150);
      const t2 = timer;
    });

    // R1 craft mode: real tool loop (write + read back)
    mockNone: {
      const s = await d.request('sessions.create', { title: 'real-llm craft', mode: 'craft', cwd: ws });
      const sessionId = s.result.id;
      const p = collect(sessionId, 'R1', 240000);
      await d.request('engine.start', { sessionId });
      await d.request('engine.userMessage', { sessionId, text:
        '请在当前工作目录创建文件 hello-real.txt，内容为 "hello from myagent"，然后用 read_file 读回来确认内容，最后告诉我文件路径。' });
      const events = await p;
      const toolCalls = events.filter((e) => e.type === 'tool_call').map((e) => e.name);
      const tokens = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
      const fileOk = fs.existsSync(path.join(ws, 'hello-real.txt'))
        && fs.readFileSync(path.join(ws, 'hello-real.txt'), 'utf8').includes('hello from myagent');
      check('R1 craft: file created via tools', fileOk, 'tools=' + toolCalls.join(','));
      check('R1 craft: read_file used', toolCalls.includes('read_file'));
      check('R1 craft: assistant replied with path', /hello-real\.txt/.test(tokens), tokens.slice(-120).replace(/\s+/g, ' '));
    }

    // R2 ask mode: write request must be refused by policy
    {
      const s = await d.request('sessions.create', { title: 'real-llm ask', mode: 'ask', cwd: ws });
      const sessionId = s.result.id;
      const p = collect(sessionId, 'R2', 240000);
      await d.request('engine.start', { sessionId });
      await d.request('engine.userMessage', { sessionId, text: '请创建一个名为 ask-deny.txt 的文件，内容随意。' });
      const events = await p;
      const denied = events.some((e) => e.type === 'tool_result' && e.ok === false && (e.reason === 'policy' || e.reason === 'denied'));
      const tokens = events.filter((e) => e.type === 'token').map((e) => e.text).join('');
      check('R2 ask: no file written', !fs.existsSync(path.join(ws, 'ask-deny.txt')));
      check('R2 ask: refused (policy or explanation)', denied || /ask|只读|read-only|无法|不能/i.test(tokens), tokens.slice(0, 100).replace(/\s+/g, ' '));
    }
  } catch (e) {
    check('exception', false, String(e && e.message || e));
  } finally {
    d.child.kill();
  }

  fs.mkdirSync(path.join(__dirname, '..', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'real-llm-result.json'), JSON.stringify(results, null, 2));
  const allOk = results.checks.every((c) => c.ok);
  console.log(allOk ? 'REAL-LLM CHECKS ALL PASS' : 'REAL-LLM CHECKS HAVE FAILURES');
  process.exit(allOk ? 0 : 1);
})();
