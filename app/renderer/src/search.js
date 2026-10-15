const $ = (s) => document.querySelector(s);
const rpc = async (method, params) => {
  const r = await window.myagent.invoke(method, params);
  if (!r.ok) throw new Error((r.error && r.error.message) || 'rpc error');
  return r.result;
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sessions = [];
let activeTab = 'all';
async function run() {
  const q = $('#q').value.trim();
  const spinner = $('#gs-spinner') || document.getElementById('gs-empty');
  if (!q) { renderEmpty(); return; }
  if (spinner) spinner.classList.add('hidden');
  if (!sessions.length) sessions = await rpc('sessions.list');
  const results = (await rpc('search.query', { q })).filter((r) =>
    activeTab === 'all' ? true : activeTab === 'message' ? r.type === 'message' : r.type !== 'message');
  const ul = $('#results');
  ul.innerHTML = '';
  for (const r of results) {
    const li = document.createElement('li');
    if (r.type === 'message') {
      const sess = sessions.find((s) => s.id === r.session_id);
      li.innerHTML = '<span class="tag">message</span> <b>' + escapeHtml(sess ? sess.title : r.session_id) + '</b> <span class="dim">[' + escapeHtml(r.role) + ']</span><br>' + escapeHtml(r.content);
      li.onclick = () => window.close();
    } else {
      li.innerHTML = '<span class="tag">file</span> <b>' + escapeHtml(r.path) + '</b>:<span class="dim">' + r.line + '</span><br><code>' + escapeHtml(r.text) + '</code>';
    }
    ul.appendChild(li);
  }
  if (!results.length) ul.innerHTML = '<li class="dim">no results</li>';
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
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
});
