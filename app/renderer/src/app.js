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
});

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

// WorkBuddy home empty-state: brand title + scene chips (design/27 F30)
function showHomeHero() {
  const hero = document.createElement('div');
  hero.className = 'home-hero';
  hero.innerHTML = '<div class="home-hero__title">MyAgent</div>' +
    '<div class="home-hero__chips"><span class="chip">日常办公</span>' +
    '<span class="chip">代码开发</span><span class="chip">设计创意</span></div>' +
    '<div class="home-hero__hint">选择场景，在下方输入框开始任务</div>';
  $('#messages').appendChild(hero);
}

// ---------- sessions ----------
async function refreshSessions(preloaded) {
  sessions = preloaded || await rpc('sessions.list');
  const ul = $('#session-list');
  ul.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.textContent = s.title;
    li.dataset.id = s.id;
    if (current && s.id === current.id) li.classList.add('active');
    li.onclick = () => openSession(s.id);
    ul.appendChild(li);
  }
}

async function openSession(id) {
  const s = await rpc('sessions.get', { id });
  current = s; mode = s.mode || 'craft';
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

async function newSession() {
  const cwd = (await window.myagent.windowAction('pickDirectory')) || undefined;
  current = await rpc('sessions.create', { title: 'Session ' + new Date().toLocaleString(), cwd });
  $('#session-title').textContent = current.title;
  $('#messages').innerHTML = '';
  showHomeHero();
  refreshSessions();
}

function updateModeButtons() {
  document.querySelectorAll('#mode-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

// ---------- send ----------
function setSendEnabled(on) { $('#btn-send').disabled = !on; $('#btn-send').textContent = on ? '发送' : '…'; }

async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text || !current) return;
  input.value = '';
  appendMessage('user', { content: text });
  try {
    if (!engineRunning) {
      await rpc('engine.start', { sessionId: current.id });
      engineRunning = true;
      setSendEnabled(false);
    }
    await rpc('engine.userMessage', { sessionId: current.id, text });
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
  $('#btn-new').onclick = newSession;
  $('#btn-send').onclick = send;
  $('#btn-terminal').onclick = toggleTerminal;
  $('#btn-preview').onclick = async () => {
    const file = await window.myagent.windowAction('pickFile');
    if (file) window.myagent.windowAction('openPreview', { path: file });
  };
  $('#btn-search').onclick = () => window.myagent.windowAction('openSearch');
  $('#btn-settings').onclick = () => window.myagent.windowAction('openSettings');
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
    else await newSession();
  } catch (e) {
    setDaemonStatus(false);
    appendMessage('event', { content: 'daemon not reachable: ' + e.message });
  }
});
