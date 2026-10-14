import DOMPurify from 'dompurify';

const $ = (s) => document.querySelector(s);
const rpc = async (method, params) => {
  const r = await window.myagent.invoke(method, params);
  if (!r.ok) throw new Error((r.error && r.error.message) || 'rpc error');
  return r.result;
};

async function loadSettings() {
  const all = await rpc('settings.all');
  $('#llm-base').value = all['llm.baseUrl'] || '';
  $('#llm-model').value = all['llm.model'] || '';
  $('#prewarm-chk').checked = all['engine.prewarm'] === true;
  const theme = await window.myagent.windowAction('theme') || 'dark';
  $('#theme-select').value = theme;
  document.body.dataset.theme = theme;
}

async function loadSelfcheck() {
  const sc = await rpc('app.selfcheck');
  $('#selfcheck').textContent = JSON.stringify(sc, null, 2);
}

async function loadSkills() {
  const skills = await rpc('skills.list');
  const ul = $('#skill-list');
  ul.innerHTML = '';
  for (const s of skills) {
    const li = document.createElement('li');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !s.disable;
    cb.onchange = () => rpc('skills.toggle', { name: s.name, enabled: cb.checked });
    const span = document.createElement('span');
    span.textContent = ' ' + s.name + ' — ' + s.description + ' [' + s.source + ']';
    const del = document.createElement('button');
    del.textContent = 'uninstall'; del.className = 'danger small';
    del.onclick = async () => { try { await rpc('skills.uninstall', { name: s.name }); loadSkills(); } catch (e) { $('#skill-msg').textContent = e.message; } };
    li.append(cb, span, del);
    ul.appendChild(li);
  }
}

async function loadMemory() {
  const items = await rpc('memory.list', {});
  const ul = $('#mem-list');
  ul.innerHTML = '';
  for (const m of items) {
    const li = document.createElement('li');
    li.textContent = '[' + m.kind + '] ' + m.content;
    const del = document.createElement('button');
    del.textContent = '×'; del.className = 'danger small';
    del.onclick = async () => { await rpc('memory.delete', { id: m.id }); loadMemory(); };
    li.appendChild(del);
    ul.appendChild(li);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadSettings().catch(() => {});
  loadSelfcheck().catch(() => {});
  loadSkills().catch(() => {});
  loadMemory().catch(() => {});

  const save = (k, v) => rpc('settings.set', { key: k, value: v }).catch(() => {});
  $('#llm-base').onchange = (e) => save('llm.baseUrl', e.target.value.trim());
  $('#llm-model').onchange = (e) => save('llm.model', e.target.value.trim());
  $('#llm-key').onchange = (e) => { if (e.target.value) { save('llm.apiKey', e.target.value); e.target.value = ''; } };
  $('#prewarm-chk').onchange = (e) => save('engine.prewarm', e.target.checked);
  $('#theme-select').onchange = (e) => {
    document.body.dataset.theme = e.target.value;
    window.myagent.windowAction('setTheme', { theme: e.target.value });
  };
  $('#btn-test-llm').onclick = async () => {
    $('#llm-test-result').textContent = 'testing…';
    try { await rpc('memory.test.llm'); $('#llm-test-result').textContent = 'OK'; }
    catch (e) { $('#llm-test-result').textContent = 'fail: ' + e.message; }
  };
  $('#btn-mem-add').onclick = async () => {
    const v = $('#mem-input').value.trim();
    if (!v) return;
    const kind = v.toLowerCase().startsWith('remember:') ? 'preference' : 'fact';
    await rpc('memory.add', { kind, content: v.replace(/^remember:\s*/i, '') });
    $('#mem-input').value = '';
    loadMemory();
  };
  $('#btn-import-skill').onclick = async () => {
    const dir = await window.myagent.windowAction('pickDirectory');
    if (!dir) return;
    try { await rpc('skills.install', { source: dir }); loadSkills(); $('#skill-msg').textContent = 'installed'; }
    catch (e) { $('#skill-msg').textContent = e.message; }
  };
  $('#btn-export').onclick = async () => {
    const data = await rpc('data.export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'myagent-export.json';
    a.click();
    $('#data-msg').textContent = 'exported';
  };
  $('#btn-clear').onclick = async () => {
    if (!confirm('Delete ALL sessions and memory?')) return;
    await rpc('data.clear');
    $('#data-msg').textContent = 'cleared';
  };
});
