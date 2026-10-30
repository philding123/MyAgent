// Renderer entry (F17): chat UI, streaming render pipeline, confirm bar,
// terminal panel. Bundled by esbuild with marked/highlight.js/katex/dompurify/xterm.

import { marked } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { ArtifactCenter } from './artifact-center.js';
import { collectArtifacts } from '../../shared/artifacts.js';

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

// F60 code blocks (design/44 §6): highlight + header with language label and
// copy button. Runs on final text only (streaming re-renders every token).
// hljs builds its spans from textContent, so sanitized output stays text.
function decorateCode(container) {
  for (const code of container.querySelectorAll('pre > code')) {
    const pre = code.parentElement;
    if (pre.classList.contains('has-head') || code.classList.contains('language-mermaid')) continue;
    const lang = (/language-([\w+-]+)/.exec(code.className) || [])[1] || '';
    if (lang && hljs.getLanguage(lang)) {
      try { hljs.highlightElement(code); } catch (_) {}
    }
    const head = document.createElement('div');
    head.className = 'code-head';
    const label = document.createElement('span');
    label.textContent = lang || 'text';
    const copy = document.createElement('button');
    copy.className = 'code-copy';
    copy.type = 'button';
    copy.textContent = '复制';
    copy.onclick = () => {
      navigator.clipboard.writeText(code.textContent || '').then(() => {
        copy.textContent = '已复制';
        setTimeout(() => { copy.textContent = '复制'; }, 1400);
      }).catch(() => { copy.textContent = '复制失败'; });
    };
    head.append(label, copy);
    pre.classList.add('has-head');
    pre.prepend(head);
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
window.__myagentTest = {
  openSession: (id) => openSession(id),
  refresh: () => refreshSessions(),
  openHub: (tab, filter) => openHub(tab, filter),
  relTime: (ts, now) => relTime(ts, now),
  injectEngineEvent: (ev) => handleEngineEvent(ev),
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
    if (role === 'assistant' && !opts.deferMermaid) hydrateMermaid(body).then(() => decorateCode(body));
  } else if (role === 'tool') {
    el.innerHTML = toolCardHtml(opts);
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

function toolCardHtml(o) {
  return '<div class="tool-chip"><span class="tool-name">' + escapeHtml(o.tool || '') +
    '</span><span class="tool-summary">' + escapeHtml(o.summary || '') + '</span>' +
    (o.ok === false ? '<span class="tool-fail">failed</span>' : '') + '</div>' +
    (o.detail ? '<pre class="tool-detail">' + escapeHtml(o.detail) + '</pre>' : '');
}

// wb ACP accumulator semantics (reverse: wb merges tool_call_update into the
// card found by toolCallId): one card per tool call, the result updates it in
// place instead of appending a second card.
const toolCards = new Map(); // engine tool_call id -> { el, name }

// F48: the visible plan (wb subtask list) — one card, updated in place
let todoEl = null;

function appendTodoCard() {
  const el = document.createElement('div');
  el.className = 'msg todo-card';
  el.innerHTML = '<div class="todo-title">任务计划</div><div class="todo-rows"></div>';
  $('#messages').appendChild(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

function renderTodos(el, todos) {
  const rows = el.querySelector('.todo-rows');
  rows.innerHTML = '';
  for (const t of todos || []) {
    const r = document.createElement('div');
    r.className = 'todo-row' + (t.done ? ' done' : '');
    r.innerHTML = '<span class="todo-mark">' + (t.done ? '✓' : '○') + '</span>' + escapeHtml(t.text);
    rows.appendChild(r);
  }
  el.scrollIntoView({ block: 'end' });
}

// F49: run progress (wb 已处理时长/步数) in a slim line above the composer
let progressStart = 0;
let progressTimer = null;
function fmtElapsed() { return Math.round((Date.now() - progressStart) / 1000) + 's'; }
function showProgress(text) {
  $('#progress-line').classList.remove('hidden');
  $('#progress-line').textContent = text;
}
function startProgress() {
  progressStart = Date.now();
  showProgress('思考中 · 0s');
  clearInterval(progressTimer);
  progressTimer = setInterval(() => showProgress('思考中 · ' + fmtElapsed()), 1000);
}
function updateProgress(ev) {
  showProgress('第 ' + (ev.step || '?') + (ev.maxSteps ? '/' + ev.maxSteps : '') + ' 步 · ' + ev.name + ' · ' + fmtElapsed());
}
function hideProgress() {
  clearInterval(progressTimer);
  progressTimer = null;
  $('#progress-line').classList.add('hidden');
}

function updateToolCard(el, o) {
  el.innerHTML = toolCardHtml(o);
  el.scrollIntoView({ block: 'end' });
}

const artifactCenter = new ArtifactCenter({
  rpc,
  windowAction: (action, params) => window.myagent.windowAction(action, params),
});
let sessionLoad = 0;

// ---------- state ----------
let sessions = [];
let current = null; // session row
let mode = 'craft';
let streamingEl = null;
const runningSessions = new Set(); // session ids whose engine turn is in flight
let draftMode = 'craft';  // draft home: mode / workspace picked before the first send
let draftCwd = null;
let homeDir = null; // from app.version — sessions whose cwd is home are loose tasks

// F37 conversation window mode (design/41): body class hides band+sidebar and
// shows #conv-bar; boot pins the session from ?session= or falls to a draft
// (wb home state — first send materializes the session, enabling parallel tasks)
const CONVERSATION_WINDOW = new URLSearchParams(location.search).get('windowKind') === 'conversation';
if (CONVERSATION_WINDOW) {
  document.body.classList.add('conversation-window');
  $('#conv-bar').hidden = false;
  $('#conv-min').onclick = () => window.myagent.windowAction('win-self', { op: 'minimize' });
  $('#conv-close').onclick = () => window.myagent.windowAction('win-self', { op: 'close' });
  $('#conv-new').onclick = () => newTask();
}

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
  if (topic.startsWith('engine:')) {
    // track every session's engine so switching tasks never inherits another
    // session's "running" flag (the send path keys engine.start off it)
    const sid = topic.slice('engine:'.length);
    if (payload.type === 'done' || payload.type === 'engine_exit' || payload.type === 'error') runningSessions.delete(sid);
    if (current && sid === current.id) handleEngineEvent(payload);
  }
  if (topic === 'sessions:changed') scheduleSessionRefresh();
  if (topic === 'settings:changed' && payload.key === 'llm.model') $('#composer-model').textContent = payload.value || 'local-model';
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

// sessions changed elsewhere (settings window, scheduled task, sync): re-read
// the list; if the open task no longer exists fall back to the draft home
let refreshTimer = null;
function scheduleSessionRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await refreshSessions().catch(() => {});
    if (current && !sessions.some((s) => s.id === current.id)) newTask();
  }, 80);
}

function setDaemonStatus(ok) {
  const dot = $('#daemon-status');
  dot.classList.toggle('ok', ok);
  dot.classList.toggle('bad', !ok);
  dot.title = ok ? 'daemon connected' : 'daemon reconnecting';
}

function handleEngineEvent(ev) {
  if (ev.type === 'status' && ev.stage === 'thinking') {
    artifactCenter.beginTurn();
    streamingEl = appendMessage('assistant', { content: '…' });
    startProgress();
  } else if (ev.type === 'token') {
    if (!streamingEl || !streamingEl.isConnected) streamingEl = appendMessage('assistant', { content: '' });
    streamingEl._raw = (streamingEl._raw || '') + ev.text;
    streamingEl.querySelector('.md').innerHTML = renderMarkdown(streamingEl._raw);
    streamingEl.scrollIntoView({ block: 'end' });
  } else if (ev.type === 'todo') {
    // F48: plan card (wb subtask list)
    if (!todoEl || !todoEl.isConnected) todoEl = appendTodoCard();
    renderTodos(todoEl, ev.todos);
  } else if (ev.type === 'tool_call') {
    updateProgress(ev);
    const el = appendMessage('tool', { tool: ev.name, summary: JSON.stringify(ev.args).slice(0, 140), ok: true });
    toolCards.set(ev.id, { el, name: ev.name });
  } else if (ev.type === 'tool_result') {
    const card = toolCards.get(ev.id);
    const detail = ev.detail || (ev.reason && ev.reason !== 'denied' ? ev.reason : '');
    if (card && card.el.isConnected) {
      updateToolCard(card.el, { tool: card.name, summary: ev.summary, ok: ev.ok, detail });
    } else {
      appendMessage('tool', { tool: card ? card.name : ev.id, summary: ev.summary, ok: ev.ok, detail });
    }
    if (ev.ok && ev.artifact?.path) artifactCenter.add(ev.artifact);
  } else if (ev.type === 'confirm_request') {
    showConfirm(ev);
  } else if (ev.type === 'done') {
    // stream finished: hydrate mermaid once on the final text (F19)
    if (streamingEl && streamingEl.isConnected) {
      const md = streamingEl.querySelector('.md');
      hydrateMermaid(md).then(() => decorateCode(md));
    }
    finishStreaming();
    runningSessions.delete(current && current.id);
    setSendEnabled(true);
    hideProgress();
    if (ev.reason === 'error') appendMessage('event', { content: 'engine error — see logs' });
    // F45: max-steps must be visible with a continue affordance (task-parity
    // P0-1 — the benchmark task died here silently)
    if (ev.reason === 'max-steps') appendContinueNotice();
    // F49: cumulative task token usage when the provider meters it
    if (ev.usageTokens) appendMessage('event', { content: '本次任务累计 ~' + ev.usageTokens + ' tokens' });
  } else if (ev.type === 'error') {
    finishStreaming();
    hideProgress();
    setSendEnabled(true);
    appendMessage('event', { content: 'error: ' + ev.message });
  } else if (ev.type === 'engine_exit') {
    setSendEnabled(true);
    hideProgress();
  }
}

function finishStreaming() { streamingEl = null; }

// F45: engine hit its per-turn step budget — surface it and let the user
// continue the same engine (history intact) with one click
function appendContinueNotice() {
  const el = appendMessage('event', { content: '已达到单轮步数上限，任务可能未完成。' });
  const b = document.createElement('button');
  b.className = 'primary';
  b.textContent = '继续';
  b.onclick = async () => {
    b.disabled = true;
    $('#input').value = '继续';
    await send();
  };
  el.appendChild(b);
}

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

// wb-live-home.png: line icons in the segmented scene switch, seven chips
const PILL_ICONS = {
  office: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M5.5 5V3.8c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V5M2.5 5.2h11v7.6h-11z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  dev: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  design: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 2a6 6 0 1 0 0 12c.8 0 1.2-.5 1.2-1.1 0-.8-.6-1-.6-1.7 0-.6.5-1 1.1-1H11a3 3 0 0 0 3-3C14 4.4 11.3 2 8 2z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5" cy="7" r=".9" fill="currentColor"/><circle cx="8" cy="5" r=".9" fill="currentColor"/></svg>',
};
// scene switch (办公/开发/设计) swaps the chip row and the suggestion list;
// 办公 = the wb-live-home.png default content
const SCENES = {
  office: {
    chips: ['创作文档', '金融服务', '分析数据', '制作PPT', '深度研究', '策划方案', '定时任务'],
    suggestions: ['做一张应收、应付和开票查询表', '每周一提醒我安排本周工作重点', '做一份年报审计准备清单', '开会前30分钟提醒我准备会议资料'],
  },
  dev: {
    chips: ['代码审查', '修复 Bug', '写单元测试', '解释代码', '重构模块', '搭建 MCP 服务', '写技术文档'],
    suggestions: ['审查当前工作区最近的改动并列出风险', '为这个模块补齐单元测试', '解释这段代码的执行流程并画时序图', '把这个脚本改写成可复用的命令行工具'],
  },
  design: {
    chips: ['海报设计', '配色方案', '落地页', '品牌规范', '图标草图', '演示文稿主题', '算法艺术'],
    suggestions: ['设计一张活动海报并导出 PNG', '给我的产品出三套配色方案', '做一个产品介绍落地页 HTML', '为周会 PPT 设计一套统一主题'],
  },
};
let scene = 'office';

// WorkBuddy v5.8.2 home (design/33): 「MyAgent, 我帮你」 title + scene pill
// row + chips row; suggestions live under the composer
function showHomeHero() {
  const hero = document.createElement('div');
  hero.className = 'home-hero';
  hero.innerHTML = '<div class="home-hero__title">MyAgent, 我帮你</div>' +
    '<div class="home-hero__pills">' +
    '<button class="pill" data-scene="office">' + PILL_ICONS.office + '办公</button>' +
    '<button class="pill" data-scene="dev">' + PILL_ICONS.dev + '开发</button>' +
    '<button class="pill" data-scene="design">' + PILL_ICONS.design + '设计</button></div>' +
    '<div class="home-hero__chips"></div>';
  $('#messages').appendChild(hero);
  hero.querySelectorAll('.home-hero__pills .pill').forEach((p) => {
    p.onclick = () => { scene = p.dataset.scene; renderScene(hero); };
  });
  renderScene(hero);
}

function renderScene(hero) {
  hero.querySelectorAll('.home-hero__pills .pill').forEach((p) => p.classList.toggle('active', p.dataset.scene === scene));
  const chips = hero.querySelector('.home-hero__chips');
  chips.innerHTML = '';
  for (const c of SCENES[scene].chips) {
    const el = document.createElement('span');
    el.className = 'chip';
    el.textContent = c;
    el.onclick = () => { const i = $('#input'); i.value = c; i.focus(); };
    chips.appendChild(el);
  }
  renderSuggestions();
}

function renderSuggestions() {
  const list = $('#suggestion-list');
  list.innerHTML = '';
  for (const s of SCENES[scene].suggestions) {
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

// wb sidebar time column: 刚刚 / N分钟前 / N小时前 / N天前 (<7d) / M月D日
// (same year) / YYYY/M/D
function relTime(ts, now = Date.now()) {
  if (!ts) return '';
  const d = Math.max(0, now - ts);
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return Math.floor(d / 60e3) + '分钟前';
  if (d < 86400e3) return Math.floor(d / 3600e3) + '小时前';
  if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + '天前';
  const t = new Date(ts); const n = new Date(now);
  return t.getFullYear() === n.getFullYear() ? (t.getMonth() + 1) + '月' + t.getDate() + '日'
    : t.getFullYear() + '/' + (t.getMonth() + 1) + '/' + t.getDate();
}

function sessionRow(s) {
  const li = document.createElement('li');
  const title = document.createElement('span');
  title.className = 'sr-title';
  title.textContent = s.title;
  const time = document.createElement('span');
  time.className = 'sr-time';
  time.textContent = relTime(s.updated_at);
  li.append(title, time);
  li.title = s.title;
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
    // the daemon defaults cwd to the home dir — that is "no workspace" (wb 任务)
    const key = s.space || (s.cwd && s.cwd !== homeDir ? s.cwd : null);
    if (key) {
      if (!spaces.has(key)) spaces.set(key, { label: s.space || basename(s.cwd), list: [] });
      spaces.get(key).list.push(s);
    } else loose.push(s);
  }
  $('#tasks-label').textContent = `任务 (${loose.length})`;
  if (!loose.length) {
    const d = document.createElement('div');
    d.className = 'side-empty';
    d.textContent = '暂无任务';
    ul.appendChild(d);
  }
  loose.forEach((s) => ul.appendChild(sessionRow(s)));
  const sg = $('#space-groups');
  sg.innerHTML = '';
  if (spaces.size) {
    const label = document.createElement('div');
    label.className = 'side-section-label';
    label.textContent = `空间 (${spaces.size})`;
    sg.appendChild(label);
  }
  for (const [, g] of spaces) {
    const row = document.createElement('div');
    row.className = 'space-row';
    row.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.2l1.4 1.5H13c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg><span class="sr-title"></span>';
    row.querySelector('.sr-title').textContent = g.label;
    row.title = g.label;
    sg.appendChild(row);
    const nested = document.createElement('ul');
    nested.className = 'session-list-nested';
    g.list.forEach((s) => nested.appendChild(sessionRow(s)));
    sg.appendChild(nested);
  }
}

async function openSession(id) {
  const load = ++sessionLoad;
  let s;
  try { s = await rpc('sessions.get', { id }); }
  catch (error) {
    if (load === sessionLoad) appendMessage('event', { content: '无法打开会话：' + error.message });
    return;
  }
  if (load !== sessionLoad) return;
  if (!s) { appendMessage('event', { content: '会话不存在或已删除' }); return; }
  current = s; mode = s.mode || 'craft';
  closeHub();
  setHomeMode(false);
  // home dir = no workspace (daemon default cwd): no space segment in the crumb
  const spaceName = s.space || (s.cwd && s.cwd !== homeDir ? basename(s.cwd) : '');
  $('#crumb-space').textContent = spaceName;
  $('#crumb-space').classList.toggle('hidden', !spaceName);
  $('#crumb-sep').classList.toggle('hidden', !spaceName);
  $('#session-title').textContent = s.title;
  $('#conv-title').textContent = s.title;
  updateModeButtons();
  updateWorkspaceChip();
  setSendEnabled(!runningSessions.has(s.id));
  $('#messages').innerHTML = '';
  toolCards.clear();
  todoEl = null;
  hideProgress();
  if (!(s.messages || []).length) showHomeHero();
  for (const m of s.messages || []) {
    if (m.role === 'user' || m.role === 'assistant') appendMessage(m.role, { content: m.content });
    else if (m.role === 'tool') {
      let ok = true;
      try { ok = JSON.parse(m.tool_json || '{}').ok !== false; } catch (_) {}
      appendMessage('tool', { tool: m.tool_name || 'tool', summary: m.content, ok });
    }
  }
  artifactCenter.setSession(s.id, collectArtifacts(s.messages || [], s.id));
  refreshSessions();
}

// wb semantics (behavior parity round): 新建任务 = draft state — focus the
// composer on the home view; the session is created when the first message
// is sent (title taken from it)
function newTask() {
  sessionLoad++;
  artifactCenter.setSession(null);
  current = null;
  closeHub();
  setHomeMode(true);
  mode = 'craft'; draftMode = 'craft'; draftCwd = null;
  updateModeButtons();
  updateWorkspaceChip();
  setSendEnabled(true);
  $('#crumb-space').classList.add('hidden');
  $('#crumb-sep').classList.add('hidden');
  $('#session-title').textContent = '新任务';
  $('#conv-title').textContent = '新任务';
  $('#messages').innerHTML = '';
  toolCards.clear();
  todoEl = null;
  hideProgress();
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
const SEND_ICON = '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BUSY_ICON = '<span class="send-busy" aria-hidden="true"></span>';
function setSendEnabled(on) {
  const btn = $('#btn-send');
  btn.disabled = !on;
  btn.dataset.state = on ? 'idle' : 'busy';
  btn.innerHTML = on ? SEND_ICON : BUSY_ICON;
}

// 「选择工作空间」: draft → remembered for the session the first send creates;
// open task → sessions.setCwd. Home dir counts as "no workspace".
function updateWorkspaceChip() {
  const cwd = current ? current.cwd : draftCwd;
  const has = cwd && cwd !== homeDir;
  $('#sub-workspace').textContent = (has ? basename(cwd) : '选择工作空间') + ' ▾';
  $('#sub-workspace').title = has ? cwd : '当前会话工作空间';
}
async function pickWorkspace() {
  const dir = await window.myagent.windowAction('pickDirectory');
  if (!dir) return;
  if (current) {
    await rpc('sessions.setCwd', { id: current.id, cwd: dir });
    current.cwd = dir;
  } else draftCwd = dir;
  updateWorkspaceChip();
}

async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  // F43: @"path" tokens become engine context (stripped from the message and
  // from the task title)
  const context = [...text.matchAll(/@"([^"]+)"/g)].map((m) => m[1]);
  const clean = context.length ? text.replace(/@"[^"]+"/g, '').replace(/ {2,}/g, ' ').trim() : text;
  if (!clean && !context.length) return;
  // draft → session materializes on first send (wb behavior)
  if (!current) {
    // the draft's mode / workspace choices belong to the session it becomes
    current = await rpc('sessions.create', { title: (clean || basename(context[0])).slice(0, 30), mode: draftMode, ...(draftCwd ? { cwd: draftCwd } : {}) });
    mode = current.mode;
    artifactCenter.setSession(current.id);
    setHomeMode(false);
    $('#session-title').textContent = current.title;
    updateModeButtons();
  }
  input.value = '';
  appendMessage('user', { content: clean });
  // attached files are visible on the message (they ride as engine context)
  if (context.length) appendMessage('event', { content: '📎 ' + context.map(basename).join('、') });
  const sid = current.id;
  try {
    if (!runningSessions.has(sid)) {
      await rpc('engine.start', { sessionId: sid });
      runningSessions.add(sid);
      setSendEnabled(false);
    }
    await rpc('engine.userMessage', { sessionId: sid, text: clean, context });
  } catch (e) {
    appendMessage('event', { content: 'send failed: ' + e.message });
    runningSessions.delete(sid);
    setSendEnabled(true);
  }
}

// ---------- F54 「专家·技能·连接器」 hub (design/35) ----------
// Main-area page like wb: three tabs; the 技能 tab merges the builtin Claude
// skills catalog (market.list) with locally installed skills (skills.list).
const HUB_GROUPS = { creative: '创意设计', dev: '开发技术', enterprise: '企业沟通', document: '文档' };
const EXPERT_GROUPS = { engineering: 'dev', testing: 'dev', security: 'dev', design: 'creative', product: 'enterprise', research: 'document', finance: 'enterprise' };
const hub = { tab: 'skills', filter: 'all', q: '', plugins: [], skills: [], catalogs: [],
  expertFilter: 'all', expertQ: '', mine: [], experts: [], expertCatalog: null, expertModalId: null };

function setNavActive(id) {
  document.querySelectorAll('#sb-nav .nav-item').forEach((b) => b.classList.toggle('active', b.id === id));
}

async function openHub(tab, filter) {
  hub.tab = tab || hub.tab;
  if (filter) hub.filter = filter;
  document.getElementById('main').classList.add('hub-open');
  $('#hub').classList.remove('hidden');
  setNavActive('nav-hub');
  renderHubTabs();
  await loadHubTab();
}

function closeHub() {
  const main = document.getElementById('main');
  if (!main.classList.contains('hub-open')) return;
  main.classList.remove('hub-open');
  $('#hub').classList.add('hidden');
  setNavActive('btn-new');
}

function renderHubTabs() {
  document.querySelectorAll('#hub .hub-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === hub.tab));
  document.querySelectorAll('#hub .hub-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== hub.tab));
  document.querySelectorAll('#hub-filters .hub-chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === hub.filter));
}

async function loadHubTab() {
  try {
    if (hub.tab === 'skills') {
      const [ls, skills] = await Promise.all([rpc('market.list', {}), rpc('skills.list')]);
      hub.plugins = ls.plugins; hub.catalogs = ls.catalogs; hub.skills = skills;
      renderHubSkills();
    } else if (hub.tab === 'experts') {
      // F56: 我的专家 (presets) + 开源专家目录 (vendored agency-agents personas)
      const [mine, cat] = await Promise.all([rpc('presets.list'), rpc('experts.list')]);
      hub.mine = mine;
      hub.experts = (cat && cat.experts) || [];
      hub.expertCatalog = (cat && cat.catalog) || null;
      renderHubExperts();
    } else if (hub.tab === 'connectors') {
      const list = await rpc('connectors.list');
      const tag = (c) => (c.enabled === false ? '已停用'
        : c.state === 'connected' ? '已连接 · ' + c.tools.length + ' 个工具'
          : c.state === 'starting' ? '连接中…'
            : c.state === 'error' ? '错误：' + (c.error || '') : '未连接');
      renderHubCards('#hub-connector-grid', '#hub-connector-empty', list.map((c) => ({
        title: c.name || c.id, desc: (c.command || '') + ' ' + (c.args || []).join(' '), tag: tag(c), letter: c.name || c.id })));
      // a handshake in flight settles within seconds — keep the card live
      if (list.some((c) => c.enabled !== false && c.state === 'starting')) {
        setTimeout(() => { if (hub.tab === 'connectors' && !$('#hub').classList.contains('hidden')) loadHubTab(); }, 700);
      }
    }
  } catch (e) {
    $('#hub-banner').textContent = '加载失败：' + e.message;
  }
}

function cardIcon(letter, group) {
  const ico = document.createElement('span');
  ico.className = 'sc-ico sc-ico--' + (group || 'other');
  ico.textContent = String(letter || '?').replace(/^[^A-Za-z一-龥]+/, '').slice(0, 1).toUpperCase();
  return ico;
}

function renderHubCards(gridSel, emptySel, items) {
  const grid = $(gridSel);
  grid.innerHTML = '';
  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'skill-card';
    const main = document.createElement('div');
    main.className = 'sc-main';
    main.innerHTML = '<div class="sc-name"><span class="sc-title"></span><span class="sc-tag"></span></div><div class="sc-desc"></div>';
    main.querySelector('.sc-title').textContent = it.title;
    main.querySelector('.sc-tag').textContent = it.tag || '';
    main.querySelector('.sc-desc').textContent = it.desc || '';
    card.append(cardIcon(it.letter, it.group), main);
    grid.appendChild(card);
  }
  $(emptySel).classList.toggle('hidden', items.length > 0);
}

// ---------- F56 open-source expert catalog (design/39) ----------
function expertIcon(emoji, division) {
  const ico = document.createElement('span');
  ico.className = 'sc-ico sc-ico--' + (EXPERT_GROUPS[division] || 'other');
  ico.textContent = emoji && emoji.trim() ? emoji.trim().slice(0, 2) : '?';
  return ico;
}

function expertCatalogCard(e) {
  const card = skillCardShell(e.name, e.division, e.display_name || e.name, e.division_zh || e.division,
    e.description_zh || e.description, (e.name || '') + (e.license ? ' · ' + e.license : '') + '\n' + (e.description || ''));
  card.replaceChild(expertIcon(e.emoji, e.division), card.querySelector('.sc-ico'));
  card.dataset.expert = e.id;
  const act = document.createElement('button');
  act.className = 'sc-act';
  if (e.installed) {
    act.textContent = '已导入';
    act.classList.add('sc-act--done');
    act.title = '已在「我的专家」中';
  } else {
    act.textContent = '导入';
    act.onclick = () => importExpert(e.id);
  }
  const view = document.createElement('button');
  view.className = 'sc-act sc-act--view';
  view.textContent = '查看';
  view.title = '查看完整提示词';
  view.onclick = () => openExpertModal(e.id);
  card.append(view, act);
  return card;
}

function renderHubExperts() {
  // 我的专家 — presets, locally created or catalog-imported (tag shows origin)
  const q = hub.expertQ.trim().toLowerCase();
  const mine = hub.mine.filter((p) => !q
    || (p.name + ' ' + (p.description || '')).toLowerCase().includes(q));
  renderHubCards('#hub-expert-grid', '#hub-expert-empty', mine.map((p) => ({
    title: p.name, desc: (p.description || p.prompt || '').slice(0, 160),
    tag: p.meta && p.meta.source ? '目录导入' : '本地', letter: p.name,
  })));
  $('#expert-mine-label').textContent = `我的专家 (${mine.length})`;

  // 开源目录 — division chips + text filter over the vendored catalog
  const list = hub.experts.filter((e) => {
    if (hub.expertFilter === 'installed') return e.installed;
    if (hub.expertFilter !== 'all' && e.division !== hub.expertFilter) return false;
    if (!q) return true;
    return [e.name, e.display_name, e.description, e.description_zh, e.division_zh]
      .join(' ').toLowerCase().includes(q);
  });
  const grid = $('#hub-expert-catalog-grid');
  grid.innerHTML = '';
  for (const e of list) grid.appendChild(expertCatalogCard(e));
  $('#hub-expert-catalog-empty').classList.toggle('hidden', list.length > 0);
  const meta = hub.expertCatalog && hub.expertCatalog.metadata || {};
  $('#expert-catalog-label').textContent = hub.expertCatalog
    ? `开源专家市场 (${list.length}/${hub.experts.length}) · agency-agents · MIT · ${String(meta.commit || '').slice(0, 7)}`
    : '开源专家市场（已关闭：experts.builtin）';
}

async function openExpertModal(id, statusNote = '') {
  let data;
  try { data = await rpc('experts.read', { id }); }
  catch (e) { hub.expertModalId = id; $('#expert-modal-name').textContent = '专家加载失败';
    $('#expert-modal-meta').textContent = ''; $('#expert-modal-prompt').textContent = e.message;
    $('#expert-modal-status').textContent = ''; const b = $('#expert-modal-import'); b.textContent = '不可导入'; b.disabled = true;
    $('#expert-modal').classList.remove('hidden'); return; }
  hub.expertModalId = id;
  $('#expert-modal-name').textContent = (data.display_name || data.name) + ' · ' + data.name;
  $('#expert-modal-meta').textContent = [data.division_zh || data.division, data.license,
    data.commit ? '上游 ' + String(data.commit).slice(0, 7) : ''].filter(Boolean).join(' · ');
  // untrusted persona text: plain textContent only, never innerHTML
  $('#expert-modal-prompt').textContent = data.prompt;
  const installed = hub.experts.find((e) => e.id === id && e.installed);
  const btn = $('#expert-modal-import');
  btn.textContent = installed ? '已在我的专家' : '导入为我的专家';
  btn.disabled = !!installed;
  $('#expert-modal-status').textContent = statusNote;
  $('#expert-modal').classList.remove('hidden');
  $('#expert-modal-close').focus();
}

function closeExpertModal() {
  $('#expert-modal').classList.add('hidden');
  hub.expertModalId = null;
}

async function importExpert(id) {
  let r;
  try { r = await rpc('experts.import', { id }); }
  catch (e) { r = { status: 'refused', reason: e.message }; }
  const note = r.status === 'installed' ? '已导入「我的专家」，可在会话中绑定'
    : r.status === 'already_installed' ? '此前已导入' : '导入被拒：' + (r.reason || '');
  if (hub.expertModalId === id) {
    $('#expert-modal-status').textContent = note;
    const btn = $('#expert-modal-import');
    btn.textContent = '已在我的专家';
    btn.disabled = true;
  } else if (r.status === 'refused') {
    // surface the refusal where the user is looking
    openExpertModal(id, note).catch(() => {});
  }
  if (r.status !== 'refused') {
    // refresh both lists in place; keep the hub tab open
    const [mine, cat] = await Promise.all([rpc('presets.list'), rpc('experts.list')]).catch(() => [[], { experts: [] }]);
    hub.mine = mine;
    hub.experts = (cat && cat.experts) || hub.experts;
    renderHubExperts();
  }
  return r;
}


function hubSkillItems() {
  const installedMeta = new Map(hub.skills.map((s) => [s.name, s]));
  const marketNames = new Set(hub.plugins.map((p) => p.name));
  const items = hub.plugins.map((p) => ({ kind: 'market', p, local: installedMeta.get(p.name) }));
  // locally installed skills that no catalog knows (builtin MyAgent skills,
  // imports) still belong on the 已安装 view
  for (const s of hub.skills) if (!marketNames.has(s.name)) items.push({ kind: 'local', s });
  const q = hub.q.trim().toLowerCase();
  return items.filter((it) => {
    const installed = it.kind === 'local' || it.p.installed;
    if (hub.filter === 'installed' && !installed) return false;
    if (HUB_GROUPS[hub.filter] && (it.kind === 'local' || it.p.group !== hub.filter)) return false;
    if (!q) return true;
    const hay = it.kind === 'local' ? it.s.name + ' ' + it.s.description
      : [it.p.name, it.p.display_name, it.p.description, it.p.description_zh].join(' ');
    return hay.toLowerCase().includes(q);
  });
}

function renderHubSkills() {
  const cat = hub.catalogs.find((c) => c.id === 'builtin:claude-skills');
  const banner = $('#hub-banner');
  banner.innerHTML = '';
  if (cat) {
    const n = hub.plugins.filter((p) => p.from === cat.id && p.installable).length;
    const b = document.createElement('div');
    b.className = 'hub-banner__row';
    b.innerHTML = '<span class="hub-banner__title"></span><span class="hub-banner__meta"></span>';
    b.querySelector('.hub-banner__title').textContent = cat.display_name;
    b.querySelector('.hub-banner__meta').textContent = 'Anthropic 官方分享 · ' + n + ' 个可离线安装 · 版本 ' +
      String((cat.metadata && cat.metadata.commit) || '').slice(0, 7);
    banner.appendChild(b);
  }
  const grid = $('#hub-skill-grid');
  grid.innerHTML = '';
  const items = hubSkillItems();
  for (const it of items) grid.appendChild(it.kind === 'local' ? localSkillCard(it.s) : marketSkillCard(it.p, it.local));
  $('#hub-skill-empty').classList.toggle('hidden', items.length > 0);
}

function skillCardShell(letter, group, title, tag, desc, hoverTitle) {
  const card = document.createElement('div');
  card.className = 'skill-card';
  card.title = hoverTitle || '';
  const main = document.createElement('div');
  main.className = 'sc-main';
  main.innerHTML = '<div class="sc-name"><span class="sc-title"></span><span class="sc-tag"></span></div><div class="sc-desc"></div>';
  main.querySelector('.sc-title').textContent = title;
  main.querySelector('.sc-tag').textContent = tag;
  main.querySelector('.sc-desc').textContent = desc;
  card.append(cardIcon(letter, group), main);
  return card;
}

function marketSkillCard(p, local) {
  const card = skillCardShell(p.name, p.group, p.display_name, p.author || p.market,
    p.description_zh || p.description, p.name + (p.license ? ' · ' + p.license : '') + '\n' + p.description);
  card.dataset.name = p.name;
  const act = document.createElement('button');
  act.className = 'sc-act';
  if (p.installed) {
    act.textContent = local && local.disable ? '已停用' : '已安装';
    act.classList.add('sc-act--done');
    act.onclick = () => toggleSkill(p.name, local);
  } else if (!p.installable) {
    act.textContent = '仅查看';
    act.classList.add('sc-act--view');
    act.title = p.reason;
    act.onclick = () => { if (p.homepage) window.myagent.windowAction('openExternal', { url: p.homepage }); };
  } else {
    act.textContent = '安装';
    act.onclick = async () => {
      act.disabled = true; act.textContent = '安装中…';
      try {
        const [r] = await rpc('market.install', { names: [p.name] });
        if (r.status === 'refused') { act.textContent = '失败'; act.title = r.reason || ''; return; }
      } catch (e) { act.textContent = '失败'; act.title = e.message; return; }
      await loadHubTab();
    };
  }
  card.appendChild(act);
  return card;
}

function localSkillCard(s) {
  const card = skillCardShell(s.name, 'local', s.name, s.source === 'builtin' ? 'MyAgent 内置' : '本地',
    s.description, s.dir);
  card.dataset.name = s.name;
  const act = document.createElement('button');
  act.className = 'sc-act sc-act--done';
  act.textContent = s.disable ? '已停用' : '已启用';
  act.onclick = () => toggleSkill(s.name, s);
  card.appendChild(act);
  return card;
}

async function toggleSkill(name, local) {
  const enabled = !!(local && local.disable);
  await rpc('skills.toggle', { name, enabled });
  await loadHubTab();
}

function toggleMoreMenu(force) {
  const m = $('#more-menu');
  const open = force === undefined ? m.classList.contains('hidden') : force;
  m.classList.toggle('hidden', !open);
  if (open) {
    const r = $('#nav-more').getBoundingClientRect();
    m.style.left = (r.left + 8) + 'px';
    m.style.top = (r.bottom + 4) + 'px';
  }
}

// ---------- terminal panel (F14) ----------
let term = null; let termId = null; let termKind = null;
async function toggleTerminal() {
  const panel = $('#terminal-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    if (!term) {
      const { Terminal } = await import('@xterm/xterm');
      term = new Terminal({ convertEol: false, fontSize: 12 });
      term.open($('#terminal-view'));
      // keystrokes go to the shell (the panel was display-only before)
      term.onData((data) => { if (termId) rpc('terminal.write', { id: termId, data }).catch(() => {}); });
    }
    if (!termId) {
      const r = await rpc('terminal.create', { cwd: (current && current.cwd) || undefined });
      termId = r.id;
      termKind = r.kind;
      term.write('MyAgent terminal (' + r.kind + ')\r\n');
      rpc('terminal.resize', { id: termId, cols: term.cols, rows: term.rows }).catch(() => {});
    }
    term.focus();
  }
}

function handleTerminalEvent(topic, payload) {
  if (!term) return;
  if (!termId || !topic.startsWith('terminal:' + termId + ':')) return;
  // pipe fallback has no tty: bare \n from the shell needs \r\n in xterm
  if (topic.endsWith(':data')) term.write(termKind === 'pipe' ? String(payload.data).replace(/\r?\n/g, '\r\n') : payload.data);
  if (topic.endsWith(':exit')) { term.write('\r\n[shell exited]\r\n'); termId = null; }
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
  // F37: open the current task in the reusable conversation window
  $('#btn-popout').onclick = () => {
    if (current) window.myagent.windowAction('openConversation', { id: current.id });
  };
  $('#btn-settings').onclick = () => window.myagent.windowAction('openSettings');
  // F38 band + sidebar nav (v5.8.2 real UI)
  $('#band-search').onclick = () => window.myagent.windowAction('openSearch');
  // wb six-row nav: 新建任务 / 助理 / 专家·技能·连接器 / 定时任务 / 资料库 / 更多
  $('#nav-hub').onclick = () => openHub('skills');
  $('#btn-discover').onclick = () => openHub('skills', 'all');
  $('#nav-more').onclick = (e) => { e.stopPropagation(); toggleMoreMenu(); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#more-menu')) toggleMoreMenu(false); });
  $('#nav-search').onclick = () => { toggleMoreMenu(false); window.myagent.windowAction('openSearch'); };
  $('#nav-market').onclick = () => { toggleMoreMenu(false); window.myagent.windowAction('openSettings', { panel: 'market' }); };
  $('#nav-connectors').onclick = () => { toggleMoreMenu(false); openHub('connectors'); };
  $('#nav-memory').onclick = () => { toggleMoreMenu(false); window.myagent.windowAction('openSettings', { panel: 'memory' }); };
  $('#nav-assistant').onclick = () => window.myagent.windowAction('openSettings', { panel: 'presets' });
  document.querySelectorAll('#hub .hub-tab').forEach((b) => {
    b.onclick = () => { hub.tab = b.dataset.tab; renderHubTabs(); loadHubTab(); };
  });
  document.querySelectorAll('#hub-filters .hub-chip').forEach((c) => {
    c.onclick = () => { hub.filter = c.dataset.filter; renderHubTabs(); renderHubSkills(); };
  });
  $('#hub-search').addEventListener('input', (e) => { hub.q = e.target.value; renderHubSkills(); });
  // F56 expert catalog: chips/search filter both lists; modal preview + import
  $('#expert-search').addEventListener('input', (e) => { hub.expertQ = e.target.value; renderHubExperts(); });
  $('#expert-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.hub-chip');
    if (!chip) return;
    hub.expertFilter = chip.dataset.efilter;
    document.querySelectorAll('#expert-filters .hub-chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderHubExperts();
  });
  $('#expert-modal-close').onclick = closeExpertModal;
  $('#expert-modal').addEventListener('click', (e) => { if (e.target.id === 'expert-modal') closeExpertModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#expert-modal').classList.contains('hidden')) closeExpertModal();
  });
  $('#expert-modal-import').onclick = () => { if (hub.expertModalId) importExpert(hub.expertModalId); };
  $('#hub-manage-experts').onclick = () => window.myagent.windowAction('openSettings', { panel: 'presets' });
  $('#hub-manage-connectors').onclick = () => window.myagent.windowAction('openSettings', { panel: 'connectors' });
  $('#nav-tasks').onclick = () => window.myagent.windowAction('openSettings', { panel: 'tasks' });
  $('#nav-library').onclick = () => window.myagent.windowAction('openSettings', { panel: 'library' });
  document.querySelectorAll('#band .menu-label').forEach((el) => {
    el.onclick = () => window.myagent.windowAction('menu-popup', { section: el.dataset.menu });
  });
  $('#win-min').onclick = () => window.myagent.windowAction('win-minimize');
  $('#win-max').onclick = () => window.myagent.windowAction('win-maximize');
  $('#win-close').onclick = () => window.myagent.windowAction('win-close');
  $('#btn-plus').onclick = (e) => { e.stopPropagation(); $('#plus-menu').classList.toggle('hidden'); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#plus-menu')) $('#plus-menu').classList.add('hidden'); });
  $('#composer-model').onclick = () => window.myagent.windowAction('openSettings', { panel: 'model' });
  // F43: @ file context + / skill invocation (design/34)
  $('#btn-context').onclick = async () => {
    $('#plus-menu').classList.add('hidden');
    const file = await window.myagent.windowAction('pickFile');
    if (file) { const i = $('#input'); i.value = i.value.replace(/\s*$/, '') + ` @"${file}" `; i.focus(); }
  };
  $('#btn-slash').onclick = async () => {
    $('#plus-menu').classList.add('hidden');
    // Electron 渲染层没有 prompt()：插入 / 并弹出技能内联菜单
    const input = $('#input');
    input.value = '/ ' + input.value;
    input.focus();
    try {
      const skills = await rpc('skills.list');
      let m = document.getElementById('skill-menu');
      if (m) m.remove();
      const names = skills.map((x) => x.name).slice(0, 8);
      if (!names.length) return;
      m = document.createElement('div');
      m.id = 'skill-menu';
      for (const n of names) {
        const b = document.createElement('button');
        b.className = 'mode-menu-item';
        b.textContent = '/' + n;
        b.onclick = () => { input.value = '/' + n + ' '; m.remove(); input.focus(); };
        m.appendChild(b);
      }
      $('#composer-sub').appendChild(m);
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
        if (!current) draftMode = k;
        updateModeButtons();
        if (current) rpc('sessions.setMode', { id: current.id, mode }).catch(() => {});
      };
      menuEl.appendChild(b);
    }
    $('#composer-sub').appendChild(menuEl);
  };
  rpc('app.version').then((v) => {
    $('#app-version').textContent = 'V' + v.version;
    if (v.home && v.home !== homeDir) { homeDir = v.home; refreshSessions().catch(() => {}); }
  }).catch(() => {});
  rpc('settings.get', { key: 'llm.model' }).then((m) => {
    $('#composer-model').textContent = m || 'local-model';
  }).catch(() => {});
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#sub-workspace').onclick = () => pickWorkspace().catch((e) => appendMessage('event', { content: 'workspace: ' + e.message }));
  document.querySelectorAll('#mode-switch button').forEach((b) => {
    b.onclick = async () => {
      if (!current) { draftMode = mode = b.dataset.mode; updateModeButtons(); return; }
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
    if (CONVERSATION_WINDOW) {
      // F37: pin the requested session, or start as a draft home (wb
      // conversation-window home state) — never inherit sessions[0]
      const pinned = new URLSearchParams(location.search).get('session');
      if (pinned) await openSession(pinned);
      else { setHomeMode(true); showHomeHero(); }
    } else if (sessions.length) await openSession(sessions[0].id);
    else { setHomeMode(true); showHomeHero(); } // wb home, no dir-picker on startup
  } catch (e) {
    setDaemonStatus(false);
    appendMessage('event', { content: 'daemon not reachable: ' + e.message });
  }
});
