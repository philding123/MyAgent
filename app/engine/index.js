'use strict';
// Headless agent engine (F04/F06/F07/F09). Runs as its own Node process,
// speaks JSON-Lines on stdio (same shape as WorkBuddy's codebuddy-headless
// being driven by the desktop shell).

// stdin control: {type:'init', sessionId, mode, workspace, llm:{baseUrl,apiKey,model},
//                 systemExtras:[string], skills:[{name,description}]}
//                {type:'user', text}
//                {type:'confirm', id, approved}
//                {type:'abort'}
// stdout events: status/token/tool_call/tool_result/confirm_request/done/error

const readline = require('readline');
const path = require('path');
const { JsonlCodec } = require('../daemon/jsonl');
const { compactHistory } = require('./compact');
const { Sandbox, defaultRules } = require('../daemon/sandbox');
const { makeTools } = require('./tools/index');
const { checkToolMode, systemPromptFragment } = require('./policy');
const { LlmClient } = require('./llm');

const state = {
  init: null,
  sandbox: null,
  registry: null,
  llm: null,
  history: [], // [{role, content|tool_calls|tool_call_id...}]
  pendingConfirms: new Map(),
  pendingDaemonTools: new Map(),
  aborted: false,
  turnTokens: 0,
  todos: [],
};

const emit = (ev) => process.stdout.write(JsonlCodec.encode(ev));

/** Failed tool results carry an output tail so the UI card shows WHY it
 * failed; the LLM still gets the full data via the tool history message. */
function toolDetail(result) {
  if (result.ok || !result.data) return undefined;
  const parts = [];
  if (result.data.stderr) parts.push('[stderr] ' + String(result.data.stderr).trim().slice(-600));
  if (result.data.stdout) parts.push('[stdout] ' + String(result.data.stdout).trim().slice(-400));
  return parts.length ? parts.join('\n') : undefined;
}

/** F25: call a daemon-backed capability (market) from an engine tool. */
function callDaemonTool(tool, args) {
  const id = 'dt_' + Math.random().toString(36).slice(2, 10);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.pendingDaemonTools.delete(id);
      resolve({ ok: false, summary: 'daemon tool timeout: ' + tool });
    }, 120000);
    state.pendingDaemonTools.set(id, (result) => { clearTimeout(timer); resolve(result); });
    emit({ type: 'daemon_tool_request', id, tool, args });
  });
}

async function handleInit(msg) {
  state.init = msg;
  state.mode = msg.mode || 'craft';
  // F45 (task-parity P0-1): per-task step budget, was a hard 16 that silently
  // ended real research tasks; still bounded, configurable via engine.maxSteps
  state.maxSteps = Math.max(4, Math.min(256, parseInt(msg.maxSteps, 10) || 64));
  // F50 (task-parity P1): history size budget, compaction keeps goal + recent
  state.maxContextChars = Math.max(4000, Math.min(2000000, parseInt(msg.maxContextChars, 10) || 150000));
  state.sandbox = new Sandbox(msg.sandboxRules || defaultRules(msg.workspace), { workspace: msg.workspace });
  state.registry = { read: (name) => (msg.skills || []).find((s) => s.name === name) || null,
    all: () => msg.skills || [] };
  // F22: one browser session per engine process; tool registered only when
  // the environment can drive a browser (probe + lazy playwright-core load).
  let browserDef = null;
  try {
    const { probeBrowser } = require('../shared/browser-probe');
    const { makeBrowserSession, browserToolDefinition } = require('./tools/browser');
    if (probeBrowser().available) {
      state.browserSession = makeBrowserSession();
      browserDef = browserToolDefinition(state.browserSession);
    }
  } catch (_) { /* browser stays unavailable */ }
  // F27 cloud backend (e2b-compatible): file/command tools proxy to it when
  // enabled; never both local-sandbox-checked and cloud (isolation delegated).
  let cloud = null;
  if (msg.cloud && msg.cloud.enabled && msg.cloud.apiUrl && msg.cloud.sandboxId) {
    const { CloudSandbox } = require('./cloud-sandbox');
    cloud = new CloudSandbox({
      apiUrl: msg.cloud.apiUrl, sandboxId: msg.cloud.sandboxId, apiKey: msg.cloud.apiKey || '',
      reconnectFn: async () => ({
        apiUrl: msg.cloud.apiUrl, sandboxId: msg.cloud.sandboxId,
        apiKey: (msg.cloud.refreshKey && await msg.cloud.refreshKey()) || msg.cloud.apiKey || '',
      }),
    });
  }
  state.tools = makeTools({ sandbox: state.sandbox, skillRegistry: state.registry, browser: browserDef, cloud,
    library: msg.libraryDir ? { dir: msg.libraryDir } : null,
    getPresentDestDir: () => {
      // F47: one delivery stamp folder per engine session (wb: one per task);
      // root overridable for tests (MYAGENT_DELIVERY_DIR)
      if (!state.presentDir) state.presentDir = path.join(
        process.env.MYAGENT_DELIVERY_DIR || path.join(require('os').homedir(), 'MyAgent'),
        new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
      return state.presentDir;
    },
    daemonBridge: (msg.daemonTools || []).includes('market') ? (args) => callDaemonTool('market', args) : null });
  // F48 (task-parity P1): visible plan — the todo tool mirrors wb's subtask
  // list; events drive the renderer's plan card
  state.tools.tools.todo = {
    kind: 'read',
    description: 'Maintain the visible task plan. Args: {items:[{text,done}]} — send the FULL list each time.',
    schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean' } } } } }, required: ['items'] },
    run: async (args) => {
      const items = (Array.isArray(args.items) ? args.items : []).slice(0, 20)
        .map((x) => ({ text: String(x && x.text || '').slice(0, 200), done: !!(x && x.done) }));
      state.todos = items;
      emit({ type: 'todo', todos: items });
      return { ok: true, summary: items.filter((x) => x.done).length + '/' + items.length + ' done', data: { todos: items } };
    },
  };
  state.tools.definitions.push({ type: 'function', function: { name: 'todo', description: state.tools.tools.todo.description, parameters: state.tools.tools.todo.schema } });
  // F52 connectors (wb「连接器」): MCP client tools ride the daemon bridge.
  // kind 'exec' is the fail-safe class — external arbitrary capability, so ask
  // mode denies and plan mode confirms (per-tool overrides come later).
  for (const ct of msg.connectorTools || []) {
    const schema = ct.inputSchema && ct.inputSchema.type === 'object'
      ? ct.inputSchema : { type: 'object', properties: {}, additionalProperties: true };
    state.tools.tools[ct.name] = {
      kind: 'exec',
      description: ct.description,
      schema,
      run: async (args) => callDaemonTool('mcp', { server: ct.server, name: ct.tool, arguments: args }),
    };
    state.tools.definitions.push({ type: 'function', function: { name: ct.name, description: ct.description, parameters: schema } });
  }
  state.llm = new LlmClient(msg.llm || {});
  state.history = [{ role: 'system', content: buildSystem(msg) }];
  emit({ type: 'status', stage: 'ready', mode: state.mode });
}

function buildSystem(msg) {
  const parts = [];
  parts.push('You are MyAgent, a personal AI agent desktop assistant. You help the user with coding, files, and system tasks in their workspace: ' + (msg.workspace || '.'));
  parts.push(systemPromptFragment(msg.mode || 'craft'));
  if (msg.persona) parts.push('<persona>' + msg.persona + '</persona>');
  if (msg.preferences && msg.preferences.length) {
    parts.push('<user_preferences>\n' + msg.preferences.map((p) => '- ' + p).join('\n') + '\n</user_preferences>');
  }
  if (msg.memoryFacts && msg.memoryFacts.length) {
    parts.push('<memory>\n' + msg.memoryFacts.slice(0, 10).map((m) => '- ' + m).join('\n') + '\n</memory>');
  }
  if (msg.skills && msg.skills.length) {
    parts.push('<skills>\nAvailable skills (call skill_read to load full instructions before using one):\n'
      + msg.skills.map((s) => '- ' + s.name + ': ' + s.description).join('\n') + '\n</skills>');
  }
  parts.push('Deliverable discipline: when the task asks for a file deliverable, write it into the workspace, then finish by calling present_file{path} so the file lands in the user-visible delivery folder. For research, prefer web_search/web_fetch over driving the browser. For current social/community buzz use social_fetch (hackernews; rss for RSSHub routes such as localhost:1200).');
  parts.push('Planning discipline: for multi-step tasks, call the todo tool whenever the plan forms or progress changes — items [{text,done}], full list each time.');
  if (msg.systemExtras && msg.systemExtras.length) parts.push(...msg.systemExtras);
  return parts.join('\n\n');
}

async function runTurn(userText) {
  state.history.push({ role: 'user', content: userText });
  emit({ type: 'status', stage: 'thinking' });
  for (let step = 0; step < state.maxSteps; step++) {
    if (state.aborted) { emit({ type: 'done', reason: 'aborted' }); return; }
    compactHistory(state.history, state.maxContextChars);
    const reply = await state.llm.chat(state.history, state.tools.definitions);
    if (state.llm.lastUsage && state.llm.lastUsage.total_tokens) state.turnTokens += state.llm.lastUsage.total_tokens;
    const toolCalls = reply.tool_calls || [];
    if (reply.content) {
      emit({ type: 'token', text: reply.content });
      state.history.push({ role: 'assistant', content: reply.content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    } else if (toolCalls.length) {
      state.history.push({ role: 'assistant', content: reply.content || '', tool_calls: toolCalls });
    } else {
      emit({ type: 'done', reason: 'complete' });
      return;
    }
    if (!toolCalls.length) {
      emit({ type: 'done', reason: 'complete', ...(state.turnTokens ? { usageTokens: state.turnTokens } : {}) });
      return;
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) {}
      // F49: steps ride tool_call events for the renderer's progress line
      emit({ type: 'tool_call', id: call.id, name, args, step: step + 1, maxSteps: state.maxSteps });
      const verdict = await gateTool(name, args);
      if (verdict.blocked) {
        state.history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, summary: verdict.reason }) });
        emit({ type: 'tool_result', id: call.id, ok: false, summary: verdict.reason, reason: verdict.kind });
        continue;
      }
      if (verdict.needConfirm) {
        const approved = await askConfirm(verdict);
        if (!approved) {
          state.history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, summary: 'user denied: ' + verdict.describe }) });
          emit({ type: 'tool_result', id: call.id, ok: false, summary: 'user denied', reason: 'denied' });
          continue;
        }
      }
      const tool = state.tools.tools[name];
      const result = tool ? await tool.run(args) : { ok: false, summary: 'unknown tool: ' + name };
      state.history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data }) });
      // F55: only successful structured results can register an artifact.
      // Daemon rebinds session identity and timestamps before persistence.
      const { normalizeArtifact } = require('../shared/artifacts');
      const artifactPath = result.ok && result.data && (name === 'present_file' ? result.data.dest
        : name === 'write_file' ? result.data.path : null);
      const artifact = artifactPath ? normalizeArtifact({ path: artifactPath,
        location: name === 'present_file' ? 'local' : result.data.location }, {
        sessionId: state.init.sessionId, toolCallId: call.id, sourceTool: name, createdAt: Date.now(),
      }) : null;
      emit({ type: 'tool_result', id: call.id, ok: result.ok, summary: result.summary, detail: toolDetail(result), ...(artifact ? { artifact } : {}) });
    }
  }
  emit({ type: 'done', reason: 'max-steps', ...(state.turnTokens ? { usageTokens: state.turnTokens } : {}) });
}

async function gateTool(name, args) {
  const tool = state.tools.tools[name];
  // per-arg kind (browser tool: read vs exec actions) wins over static kind
  const kind = tool ? (typeof tool.kindOf === 'function' ? tool.kindOf(args) : tool.kind) : 'read';
  // 1) mode policy (engine-enforced, mirrors interactionmode hard rules)
  const modeV = checkToolMode(state.mode, kind, name, args);
  if (modeV.verdict === 'deny') return { blocked: true, kind: 'policy', reason: modeV.reason };
  // 2) sandbox for path-bearing tools
  if (name === 'read_file' || name === 'write_file' || name === 'list_dir') {
    const op = name === 'read_file' || name === 'list_dir' ? 'read' : 'write';
    const chk = state.sandbox.checkFile(args.path, op);
    if (!chk.ok) return { blocked: true, kind: 'sandbox', reason: 'sandbox denied (' + op + '): ' + chk.path };
  }
  if (name === 'skill_read') {
    const s = state.registry.read(args.name);
    if (!s) return { blocked: true, kind: 'policy', reason: 'skill not found: ' + args.name };
  }
  // 3) confirmation for exec
  if (kind === 'exec') {
    const cmdV = state.sandbox.checkCommand(args.command || '');
    if (cmdV.verdict === 'deny') return { blocked: true, kind: 'sandbox', reason: 'command denied by rules' };
    const needConfirm = cmdV.verdict === 'confirm' || modeV.verdict === 'confirm';
    if (needConfirm) return { needConfirm: true, describe: args.command || (name + ' ' + JSON.stringify(args).slice(0, 80)), confirmId: null };
  }
  if (kind === 'write' && modeV.verdict === 'confirm') {
    return { needConfirm: true, describe: 'write ' + args.path };
  }
  return {};
}

function askConfirm(verdict) {
  return new Promise((resolve) => {
    const id = 'cf_' + Math.random().toString(36).slice(2, 10);
    state.pendingConfirms.set(id, resolve);
    const timer = setTimeout(() => { if (state.pendingConfirms.has(id)) { state.pendingConfirms.delete(id); resolve(false); } }, 120000);
    state.pendingConfirms.set(id, (ok) => { clearTimeout(timer); resolve(ok); });
    emit({ type: 'confirm_request', id, command: verdict.describe, reason: verdict.reason || 'confirmation required' });
  });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch (_) { return; }
  if (msg.type === 'daemon_tool_result') {
    const fn = state.pendingDaemonTools.get(msg.id);
    if (fn) { state.pendingDaemonTools.delete(msg.id); fn(msg.result); }
    return;
  }
  // existing control handling below
  handleControl(msg);
});

function handleControl(msg) {
  (async () => {
    try {
      if (msg.type === 'init') await handleInit(msg);
      else if (msg.type === 'user') await runTurn(msg.text);
      else if (msg.type === 'confirm') {
        const r = state.pendingConfirms.get(msg.id);
        if (r) { state.pendingConfirms.delete(msg.id); r(!!msg.approved); }
      } else if (msg.type === 'abort') state.aborted = true;
    } catch (e) {
      emit({ type: 'error', message: e.message });
      emit({ type: 'done', reason: 'error' });
    }
  })();
}
rl.on('close', () => process.exit(0));
process.on('message', (m) => { if (m && m.type === 'abort') state.aborted = true; });
