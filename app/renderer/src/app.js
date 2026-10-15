// Renderer entry (F17): chat UI, streaming render pipeline, confirm bar,
// terminal panel. Bundled by esbuild with marked/highlight.js/katex/dompurify/xterm.

import { marked } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

const $ = (sel) => document.querySelector(sel);

// ---------- render pipeline (F17 + F19 mermaid) ----------
marked.setOptions({ gfm: true, breaks: true });

// F19: client-side mermaid, on-demand render, strict security. SVG output is
// re-sanitized with the SVG profile so the XSS surface stays identical to T17.
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
let mermaidSeq = 0;

async function hydrateMermaid(container) {
  const blocks = container.querySelectorAll('pre code.language-mermaid');
  for (const code of blocks) {
    const src = code.textContent || '';
    const host = document.createElement('div');
    host.className = 'mermaid-block';
    try {
      const { svg } = await mermaid.render('mmd-' + (++mermaidSeq), src);
      host.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_ATTR: ['dominant-baseline', 'text-anchor', 'transform-origin'],
      });
      const pre = code.closest('pre');
      pre.replaceWith(host);
    } catch (e) {
      const badge = document.createElement('div');
      badge.className = 'mermaid-error';
      badge.textContent = 'mermaid render failed: ' + String(e && e.message || e).slice(0, 120);
      code.closest('pre').appendChild(badge);
    }
  }
}

// smoke hook (T19): render a mermaid sample through the full pipeline
window.__mermaidTest = async (sample) => {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(sample);
  await hydrateMermaid(div);
  return { svg: !!div.querySelector('.mermaid-block svg'), errors: div.querySelectorAll('.mermaid-error').length };
};

function renderMath(text) {
  // $$block$$ then $inline$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try { return '<span class="katex-block">' + katex.renderToString(tex.trim(), { displayMode: true }) + '</span>'; }
    catch (_) { return _; }
  });
  text = text.replace(/(^|[^\w$])\$([^$\n]+?)\$(?![\w$])/g, (_, pre, tex) => {
    try { return pre + katex.renderToString(tex.trim(), { displayMode: false }); }
    catch (_) { return pre + '$' + tex + '$'; }
  });
  return text;
}

function renderMarkdown(md) {
  const dirty = marked.parse(renderMath(md));
  return DOMPurify.sanitize(dirty, { FORBID_TAGS: ['script', 'style', 'iframe'], ADD_ATTR: ['target'] });
}

// smoke hook (T17): returns whether script injection survives sanitization
window.__renderTest = (sample) => {
  const div = document.createElement('div');
  div.innerHTML = renderMarkdown(sample);
  return { pwned: !!window.__pwned || !!div.querySelector('script'), html: div.innerHTML.slice(0, 200) };
};
// smoke hook (T29-b): let the harness drive the task view deterministically
window.__myagentTest = { openSession: (id) => openSession(id), refresh: () => refreshSessions() };

function appendMessage(role, opts = {}) {
  const hero = $('#messages .home-hero');
  if (hero) hero.remove();
  const el = document.createElement('div');
  el.className = 'msg ' + role + (opts.err ? ' err' : '');
  if (role === 'user' || role === 'assistant') {
    const body = document.createElement('div');
    body.className = 'md';
    body.innerHTML = renderMarkdown(opts.content || '');
    el.appendChild(body);
    if (role === 'assistant' && !opts.deferMermaid) hydrateMermaid(body);
  } else if (role === 'tool') {
    el.innerHTML = '<div class="tool-chip"><span class="tool-name">' + escapeHtml(opts.tool || '') +
      '</span><span class="tool-summary">' + escapeHtml(opts.summary || '') + '</span>' +
      (opts.ok === false ? '<span class="tool-fail">failed</span>' : '') + '</div>' +
      (opts.detail ? '<pre class="tool-detail">' + escapeHtml(opts.detail) + '</pre>' : '');
  } else if (role === 'event') {
    el.innerHTML = '<div class="sys-event">' + escapeHtml(opts.content || '') + '</div>';
  }
  $('#messages').appendChild(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// F44 artifact cards: files the agent writes render as wb-style cards
function appendArtifact(p) {
  let grid = document.querySelector('#messages .artifact-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'artifact-grid';
    $('#messages').appendChild(grid);
  }
  const card = document.createElement('button');
  card.className = 'artifact-card';
  card.title = p;
  card.innerHTML = '<span class="af-ico">📄</span><span class="af-name">' + escapeHtml(p.split(/[\\/]/).pop()) + '</span>';
  card.onclick = () => window.myagent.windowAction('openPreview', { path: p });
  grid.appendChild(card);
  grid.scrollIntoView({ block: 'end' });
}

// ---------- state ----------
let sessions = [];
let current = null; // session row
let mode = 'craft';
let streamingEl = null;
let engineRunning = false;

// ---------- RPC helpers ----------
async function rpc(method, params) {
  const r = await window.myagent.invoke(method, params);
  if (!r.ok) throw new Error((r.error && r.error.message) || 'rpc error');
  return r.result;
}

window.myagent.onEvent((msg) => {
  const { topic, payload } = msg;
  if (topic === 'daemon:status') setDaemonStatus(false);
  if (topic === 'daemon:ready') { setDaemonStatus(true); refreshSessions(payload.sessions); }
  if (current && topic === 'engine:' + current.id) handleEngineEvent(payload);
  if (topic.startsWith('terminal:')) handleTerminalEvent(topic, payload);
  if (topic === 'app:pendingUrls') handlePendingUrls(payload);
  if (topic === 'app:theme') document.body.dataset.theme = payload.theme;
  if (topic === 'menu:action') {
    // F35: native menu delegates to renderer actions (design/31-menu.md)
    if (payload.action === 'new-session') newTask();
    if (payload.action === 'open-settings') window.myagent.windowAction('openSettings');
    if (payload.action === 'open-search') window.myagent.windowAction('openSearch');
  }
});

// F29: adopt the persisted theme at boot (index.html ships light by default)
window.myagent.windowAction('theme').then((t) => { if (t) document.body.dataset.theme = t; });

function handlePendingUrls(list) {
  for (const u of list) {
    if (u.action === 'session' && u.id) openSession(u.id);
    if (u.action === 'settings') window.myagent.windowAction('openSettings');
  }
}

function setDaemonStatus(ok) {
  const dot = $('#daemon-status');
  dot.classList.toggle('ok', ok);
  dot.classList.toggle('bad', !ok);
  dot.title = ok ? 'daemon connected' : 'daemon reconnecting';
}

function handleEngineEvent(ev) {
  if (ev.type === 'status' && ev.stage === 'thinking') {
    streamingEl = appendMessage('assistant', { content: '…' });
  } else if (ev.type === 'token') {
    if (!streamingEl || !streamingEl.isConnected) streamingEl = appendMessage('assistant', { content: '' });
    streamingEl._raw = (streamingEl._raw || '') + ev.text;
    streamingEl.querySelector('.md').innerHTML = renderMarkdown(streamingEl._raw);
    streamingEl.scrollIntoView({ block: 'end' });
  } else if (ev.type === 'tool_call') {
    appendMessage('tool', { tool: ev.name, summary: JSON.stringify(ev.args).slice(0, 140), ok: true });
    // F44: written files surface as artifact cards (wb 产物卡片)
    if (ev.name === 'write_file' && ev.args && ev.args.path) appendArtifact(ev.args.path);
  } else if (ev.type === 'tool_result') {
    appendMessage('tool', { tool: ev.id, summary: ev.summary, ok: ev.ok, detail: ev.reason && ev.reason !== 'denied' ? ev.reason : '' });
  } else if (ev.type === 'confirm_request') {
    showConfirm(ev);
  } else if (ev.type === 'done') {
    // stream finished: hydrate mermaid once on the final text (F19)
    if (streamingEl && streamingEl.isConnected) hydrateMermaid(streamingEl.querySelector('.md'));
    finishStreaming();
    engineRunning = false;
    setSendEnabled(true);
    if (ev.reason === 'error') appendMessage('event', { content: 'engine error — see logs' });
  } else if (ev.type === 'error') {
    finishStreaming();
    appendMessage('event', { content: 'error: ' + ev.message });
  } else if (ev.type === 'engine_exit') {
    engineRunning = false;
    setSendEnabled(true);
  }
}

function finishStreaming() { streamingEl = null; }

function showConfirm(ev) {
  const bar = $('#confirm-bar');
  bar.classList.remove('hidden');
  bar.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = 'Approve command: ' + ev.command;
  const yes = document.createElement('button'); yes.textContent = 'Approve'; yes.className = 'primary';
  const no = document.createElement('button'); no.textContent = 'Deny';
  yes.onclick = () => respond(true); no.onclick = () => respond(false);
  bar.append(label, yes, no);
  async function respond(approved) {
    bar.classList.add('hidden');
    await rpc('engine.confirm', { id: ev.id, approved });
    appendMessage('event', { content: approved ? 'approved: ' + ev.command : 'denied: ' + ev.command });
  }
}

// WorkBuddy v5.8.2 home (design/33): 「MyAgent, 我帮你」 title + scene pill
// row + chips row; suggestions live under the composer
function showHomeHero() {
  const hero = document.createElement('div');
  hero.className = 'home-hero';
  hero.innerHTML = '<div class="home-hero__title">MyAgent, 我帮你</div>' +
    '<div class="home-hero__pills">' +
    '<button class="pill active">💼 办公</button>' +
    '<button class="pill">⌨ 开发</button>' +
    '<button class="pill">🎨 设计</button></div>' +
    '<div class="home-hero__chips">' +
    '<span class="chip">写周报</span><span class="chip">分析数据</span>' +
    '<span class="chip">制作PPT</span><span class="chip">深度研究</span></div>';
  $('#messages').appendChild(hero);
  renderSuggestions();
  hero.querySelectorAll('.home-hero__chips .chip').forEach((c) => {
    c.onclick = () => { const i = $('#input'); i.value = c.textContent; i.focus(); };
  });
}

const SUGGESTIONS = [
  '做一张应收、应付和开票查询表',
  '每周一提醒我安排本周工作重点',
  '做一份年报审计准备清单',
  '开会前30分钟提醒我准备会议资料',
];
function renderSuggestions() {
  const list = $('#suggestion-list');
  list.innerHTML = '';
  for (const s of SUGGESTIONS) {
    const b = document.createElement('button');
    b.className = 'suggestion';
    b.innerHTML = escapeHtml(s) + ' <span class="arr">↗</span>';
    b.onclick = () => { const i = $('#input'); i.value = s; i.focus(); };
    list.appendChild(b);
  }
}

// zero-session startup renders the wb home (hero + centered composer, no
// task header); openSession/newTask switch between task view and draft home.
// The composer sub row (选择工作空间/允许完全访问) is HOME-only — wb's
// conversation composer has no access chip (live capture wb-live-main.png).
function setHomeMode(on) {
  document.getElementById('main').classList.toggle('home', on);
  const sug = $('#suggestion-list');
  if (sug) sug.classList.toggle('hidden', !on);
  const sub = $('#composer-sub');
  if (sub) sub.classList.toggle('hidden', !on);
}

// ---------- sessions ----------
function basename(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop(); }

function sessionRow(s) {
  const li = document.createElement('li');
  li.textContent = s.title;
  li.dataset.id = s.id;
  if (current && s.id === current.id) li.classList.add('active');
  li.onclick = () => openSession(s.id);
  return li;
}

async function refreshSessions(preloaded) {
  sessions = preloaded || await rpc('sessions.list');
  const ul = $('#session-list');
  ul.innerHTML = '';
  // F39/v5.8.2 grouping: 任务 = sessions without space/cwd; 空间 = named
  // space first, then cwd-derived groups
  const loose = [];
  const spaces = new Map();
  for (const s of sessions) {
    const key = s.space || s.cwd;
    if (key) {
      if (!spaces.has(key)) spaces.set(key, { label: s.space || basename(s.cwd), list: [] });
      spaces.get(key).list.push(s);
    } else loose.push(s);
  }
  $('#tasks-label').textContent = loose.length ? `任务 (${loose.length})` : '任务';
  if (!loose.length) {
    const d = document.createElement('div');
    d.className = 'side-empty';
    d.textContent = '暂无任务';
    ul.appendChild(d);
  }
  loose.forEach((s) => ul.appendChild(sessionRow(s)));
  const sg = $('#space-groups');
  sg.innerHTML = '';
  for (const [, g] of spaces) {
    const label = document.createElement('div');
    label.className = 'side-section-label';
    label.textContent = `${g.label} (${g.list.length})`;
    sg.appendChild(label);
    const nested = document.createElement('ul');
    nested.className = 'session-list-nested';
    g.list.forEach((s) => nested.appendChild(sessionRow(s)));
    sg.appendChild(nested);
  }
}

async function openSession(id) {
  const s = await rpc('sessions.get', { id });
  current = s; mode = s.mode || 'craft';
  setHomeMode(false);
  $('#session-title').textContent = s.title;
  updateModeButtons();
  $('#messages').innerHTML = '';
  if (!(s.messages || []).length) showHomeHero();
  for (const m of s.messages || []) {
    if (m.role === 'user' || m.role === 'assistant') appendMessage(m.role, { content: m.content });
    else if (m.role === 'tool') appendMessage('tool', { tool: m.tool_name, summary: m.content, ok: true });
  }
  refreshSessions();
}

// wb semantics (behavior parity round): 新建任务 = draft state — focus the
// composer on the home view; the session is created when the first message
// is sent (title taken from it)
function newTask() {
  current = null;
  setHomeMode(true);
  $('#session-title').textContent = '新任务';
  $('#messages').innerHTML = '';
  showHomeHero();
  refreshSessions();
  $('#input').focus();
}

function updateModeButtons() {
  document.querySelectorAll('#mode-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  // F38: composer sub-mode chip mirrors the session mode (wb 允许完全访问)
  const labels = { ask: '只读问答 ▾', plan: '计划模式 ▾', craft: '允许完全访问 ▾' };
  const chipEl = $('#sub-mode');
  if (chipEl) chipEl.textContent = labels[mode] || labels.craft;
}

// ---------- send ----------
function setSendEnabled(on) { $('#btn-send').disabled = !on; $('#btn-send').textContent = on ? '发送' : '…'; }

async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  // draft → session materializes on first send (wb behavior)
  if (!current) {
    current = await rpc('sessions.create', { title: text.slice(0, 30) });
    setHomeMode(false);
    $('#session-title').textContent = current.title;
  }
  input.value = '';
  // F43: @"path" tokens become engine context (stripped from the message)
  const context = [...text.matchAll(/@"([^"]+)"/g)].map((m) => m[1]);
  const clean = context.length ? text.replace(/@"[^"]+"/g, '').replace(/ {2,}/g, ' ').trim() : text;
  appendMessage('user', { content: clean });
  try {
    if (!engineRunning) {
      await rpc('engine.start', { sessionId: current.id });
      engineRunning = true;
      setSendEnabled(false);
    }
    await rpc('engine.userMessage', { sessionId: current.id, text: clean, context });
  } catch (e) {
    appendMessage('event', { content: 'send failed: ' + e.message });
    engineRunning = false;
    setSendEnabled(true);
  }
}

// ---------- terminal panel (F14) ----------
let term = null; let termId = null;
async function toggleTerminal() {
  const panel = $('#terminal-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    if (!term) {
      const { Terminal } = await import('@xterm/xterm');
      term = new Terminal({ convertEol: false, fontSize: 12 });
      term.open($('#terminal-view'));
    }
    if (!termId) {
      const r = await rpc('terminal.create', { cwd: (current && current.cwd) || undefined });
      termId = r.id;
      term.write('MyAgent terminal (' + r.kind + ')\r\n');
    }
    term.focus();
  }
}

function handleTerminalEvent(topic, payload) {
  if (!term) return;
  if (topic.endsWith(':data') && termId && topic.startsWith('terminal:' + termId)) term.write(payload.data);
}

// ---------- wire up ----------
window.addEventListener('DOMContentLoaded', async () => {
  $('#btn-new').onclick = newTask;
  $('#btn-send').onclick = send;
  $('#btn-terminal').onclick = toggleTerminal;
  $('#btn-preview').onclick = async () => {
    const file = await window.myagent.windowAction('pickFile');
    if (file) window.myagent.windowAction('openPreview', { path: file });
  };
  $('#btn-search').onclick = () => window.myagent.windowAction('openSearch');
  $('#btn-settings').onclick = () => window.myagent.windowAction('openSettings');
  // F38 band + sidebar nav (v5.8.2 real UI)
  $('#band-search').onclick = () => window.myagent.windowAction('openSearch');
  $('#nav-search').onclick = () => window.myagent.windowAction('openSearch');
  $('#nav-market').onclick = () => window.myagent.windowAction('openSettings', { panel: 'market' });
  $('#nav-skills').onclick = () => window.myagent.windowAction('openSettings', { panel: 'skills' });
  $('#nav-memory').onclick = () => window.myagent.windowAction('openSettings', { panel: 'memory' });
  $('#nav-assistant').onclick = () => window.myagent.windowAction('openSettings', { panel: 'presets' });
  $('#nav-tasks').onclick = () => window.myagent.windowAction('openSettings', { panel: 'tasks' });
  $('#nav-library').onclick = () => window.myagent.windowAction('openSettings', { panel: 'library' });
  document.querySelectorAll('#band .menu-label').forEach((el) => {
    el.onclick = () => window.myagent.windowAction('menu-popup', { section: el.dataset.menu });
  });
  $('#win-min').onclick = () => window.myagent.windowAction('win-minimize');
  $('#win-max').onclick = () => window.myagent.windowAction('win-maximize');
  $('#win-close').onclick = () => window.myagent.windowAction('win-close');
  $('#btn-plus').onclick = () => $('#input').focus();
  // F43: @ file context + / skill invocation (design/34)
  $('#btn-context').onclick = async () => {
    const file = await window.myagent.windowAction('pickFile');
    if (file) { const i = $('#input'); i.value = i.value.replace(/\s*$/, '') + ` @"${file}" `; i.focus(); }
  };
  $('#btn-slash').onclick = async () => {
    try {
      const skills = await rpc('skills.list');
      const names = skills.map((s) => s.name);
      if (!names.length) return;
      const pick = prompt('调用技能（输入序号）：\n' + names.map((n, i) => (i + 1) + '. ' + n).join('\n'));
      const idx = parseInt(pick, 10) - 1;
      if (names[idx]) { const i = $('#input'); i.value = '/' + names[idx] + ' ' + i.value; i.focus(); }
    } catch (_) {}
  };
  $('#band-toggle').onclick = () => document.body.classList.toggle('side-collapsed');
  $('#sub-mode').onclick = () => {
    // wb behavior: the access chip opens a selection menu (not cycle-toggle)
    const existing = document.getElementById('mode-menu');
    if (existing) { existing.remove(); return; }
    const menuEl = document.createElement('div');
    menuEl.id = 'mode-menu';
    const labels = { ask: '只读问答', plan: '计划模式', craft: '允许完全访问' };
    for (const k of ['ask', 'plan', 'craft']) {
      const b = document.createElement('button');
      b.className = 'mode-menu-item' + (mode === k ? ' active' : '');
      b.textContent = labels[k];
      b.onclick = () => {
        menuEl.remove();
        mode = k;
        updateModeButtons();
        if (current) rpc('sessions.setMode', { id: current.id, mode }).catch(() => {});
      };
      menuEl.appendChild(b);
    }
    $('#composer-sub').appendChild(menuEl);
  };
  rpc('app.version').then((v) => { $('#app-version').textContent = 'V' + v.version; }).catch(() => {});
  rpc('settings.get', { key: 'llm.model' }).then((m) => {
    $('#composer-model').textContent = m || 'local-model';
  }).catch(() => {});
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  document.querySelectorAll('#mode-switch button').forEach((b) => {
    b.onclick = async () => {
      if (!current) return;
      mode = b.dataset.mode;
      updateModeButtons();
      await rpc('sessions.setMode', { id: current.id, mode });
      appendMessage('event', { content: 'mode → ' + mode });
    };
  });
  try {
    const snap = await rpc('app.selfcheck');
    setDaemonStatus(true);
    await refreshSessions();
    if (sessions.length) await openSession(sessions[0].id);
    else { setHomeMode(true); showHomeHero(); } // wb home, no dir-picker on startup
  } catch (e) {
    setDaemonStatus(false);
    appendMessage('event', { content: 'daemon not reachable: ' + e.message });
  }
});
