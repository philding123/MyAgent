const $ = (s) => document.querySelector(s);
const rpc = async (method, params) => {
  const r = await window.myagent.invoke(method, params);
  if (!r.ok) throw new Error((r.error && r.error.message) || 'rpc error');
  return r.result;
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sessions = [];
let activeTab = 'all';
let selected = -1;

// empty query = the wb empty state (icon + hint), no stale result rows
function renderEmpty() {
  $('#results').innerHTML = '';
  selected = -1;
  const empty = $('#gs-empty');
  if (empty) empty.classList.remove('hidden');
}

// a result row does what its kind means: a task opens in the main window,
// a file opens in the preview window
function openResult(r) {
  if (r.type === 'message') window.myagent.windowAction('openSession', { id: r.session_id }).then(() => window.close());
  else window.myagent.windowAction('openPreview', { path: r.path });
}

function select(i) {
  const lis = [...document.querySelectorAll('#results li[data-idx]')];
  if (!lis.length) return;
  selected = (i + lis.length) % lis.length;
  lis.forEach((l, k) => l.classList.toggle('active', k === selected));
  lis[selected].scrollIntoView({ block: 'nearest' });
}

let lastResults = [];
async function run() {
  const q = $('#q').value.trim();
  if (!q) { renderEmpty(); return; }
  const empty = $('#gs-empty');
  if (empty) empty.classList.add('hidden');
  sessions = await rpc('sessions.list'); // titles of tasks created since the window opened
  lastResults = (await rpc('search.query', { q })).filter((r) =>
    activeTab === 'all' ? true : activeTab === 'message' ? r.type === 'message' : r.type !== 'message');
  const ul = $('#results');
  ul.innerHTML = '';
  selected = -1;
  lastResults.forEach((r, idx) => {
    const li = document.createElement('li');
    li.dataset.idx = idx;
    if (r.type === 'message') {
      const sess = sessions.find((s) => s.id === r.session_id);
      li.innerHTML = '<span class="tag">message</span> <b>' + escapeHtml(sess ? sess.title : '(已删除的任务)') + '</b> <span class="dim">[' + escapeHtml(r.role) + ']</span><br>' + escapeHtml(r.content);
    } else {
      li.innerHTML = '<span class="tag">file</span> <b>' + escapeHtml(r.path) + '</b>:<span class="dim">' + r.line + '</span><br><code>' + escapeHtml(r.text) + '</code>';
    }
    li.onclick = () => openResult(r);
    li.onmousemove = () => select(idx);
    ul.appendChild(li);
  });
  if (!lastResults.length) ul.innerHTML = '<li class="dim">no results</li>';
}

window.addEventListener('DOMContentLoaded', () => {
  // F29: adopt the persisted theme and follow cross-window changes
  window.myagent.windowAction('theme').then((t) => { if (t) document.body.dataset.theme = t; });
  window.myagent.onEvent((msg) => { if (msg.topic === 'app:theme') document.body.dataset.theme = msg.payload.theme; });
  // F38: wb search tabs (全部/任务/文件) + footer ESC
  document.querySelectorAll('.gs-tab').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.gs-tab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      activeTab = b.dataset.tab;
      if ($('#q').value.trim()) run(); else renderEmpty();
    };
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
  $('#q').focus();
  // footer contract: ↑↓ move, ↵ opens the selected row (or searches when the
  // query changed / nothing is selected)
  let ranFor = null;
  $('#q').addEventListener('input', () => { ranFor = null; });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(selected + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(selected - 1); }
    else if (e.key === 'Enter') {
      const q = $('#q').value.trim();
      if (selected >= 0 && ranFor === q && lastResults[selected]) openResult(lastResults[selected]);
      else { ranFor = q; run(); }
    }
  });
});
