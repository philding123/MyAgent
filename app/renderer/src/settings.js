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
  // F21/F25/F26/F27/F28 configuration surfaces
  $('#update-url').value = all['update.manifestUrl'] || '';
  $('#market-url').value = all['market.url'] || '';
  $('#market-insecure').checked = all['market.allowInsecure'] === true;
  const sync = await rpc('sync.status');
  const cfg = await rpc('settings.get', { key: 'sync.config' }) || {};
  $('#sync-dir').value = cfg.type === 'directory' ? (cfg.path || '') : '';
  $('#sync-auto').checked = !!sync.auto;
  $('#sandbox-backend').value = all['sandbox.backend'] || 'local';
  $('#sandbox-cloud-url').value = all['sandbox.cloud.url'] || '';
  $('#sandbox-cloud-id').value = all['sandbox.cloud.sandboxId'] || '';
  const a2a = await rpc('a2a.status');
  $('#a2a-enabled').checked = !!a2a.enabled;
  $('#a2a-msg').textContent = a2a.url ? a2a.url : '';
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
  // ---- F21 updater ----
  $('#update-url').onchange = (e) => save('update.manifestUrl', e.target.value.trim());
  $('#btn-update-check').onclick = async () => {
    $('#update-msg').textContent = 'checking…';
    try {
      const r = await window.myagent.windowAction('updateCheck');
      $('#update-msg').textContent = r.ok
        ? (r.updateAvailable ? 'update available: ' + r.version : 'up to date')
        : ('error: ' + (r.reason || 'disabled'));
    } catch (e) { $('#update-msg').textContent = 'fail: ' + e.message; }
  };
  $('#btn-update-apply').onclick = async () => {
    try {
      const r = await window.myagent.windowAction('updateApply');
      $('#update-msg').textContent = r.ok ? 'applying — app will restart' : ('error: ' + (r.reason || ''));
    } catch (e) { $('#update-msg').textContent = 'fail: ' + e.message; }
  };
  // ---- F25 market ----
  $('#market-url').onchange = (e) => save('market.url', e.target.value.trim());
  $('#market-insecure').onchange = (e) => save('market.allowInsecure', e.target.checked);
  $('#btn-market-search').onclick = async () => {
    $('#market-msg').textContent = 'searching…';
    try {
      const ks = $('#market-keywords').value.split(/\s+/).filter(Boolean);
      const hits = await rpc('market.search', { keywords: ks });
      const un = hits.filter((h) => !h.installed);
      $('#market-msg').textContent = hits.length
        ? (un.length ? un[0].name + ' — ' + un[0].description : 'all hits already installed')
        : 'no hits';
    } catch (e) { $('#market-msg').textContent = 'fail: ' + e.message; }
  };
  $('#btn-market-install').onclick = async () => {
    try {
      const ks = $('#market-keywords').value.split(/\s+/).filter(Boolean);
      const hits = (await rpc('market.search', { keywords: ks })).filter((h) => !h.installed);
      if (!hits.length) { $('#market-msg').textContent = 'nothing to install'; return; }
      const r = await rpc('market.install', { names: [hits[0].name] });
      $('#market-msg').textContent = hits[0].name + ' → ' + r[0].status + (r[0].reason ? ' (' + r[0].reason + ')' : '');
      loadSkills();
    } catch (e) { $('#market-msg').textContent = 'fail: ' + e.message; }
  };
  // ---- F26 sync ----
  $('#btn-sync-save').onclick = async () => {
    const dir = $('#sync-dir').value.trim();
    await rpc('sync.configure', { config: dir ? { type: 'directory', path: dir, auto: $('#sync-auto').checked } : null });
    $('#sync-msg').textContent = dir ? 'target saved' : 'target cleared';
  };
  $('#sync-auto').onchange = async (e) => {
    const dir = $('#sync-dir').value.trim();
    if (dir) await rpc('sync.configure', { config: { type: 'directory', path: dir, auto: e.target.checked } });
  };
  $('#btn-sync-push').onclick = async () => {
    const r = await rpc('sync.push');
    $('#sync-msg').textContent = r.ok ? 'pushed ' + r.pushed : ('error: ' + r.reason);
  };
  $('#btn-sync-pull').onclick = async () => {
    const r = await rpc('sync.pull');
    $('#sync-msg').textContent = r.ok ? 'applied ' + r.applied + (r.conflicts ? ', conflicts ' + r.conflicts : '') : ('error: ' + r.reason);
  };
  // ---- F27 cloud sandbox ----
  $('#sandbox-backend').onchange = (e) => save('sandbox.backend', e.target.value);
  $('#sandbox-cloud-url').onchange = (e) => save('sandbox.cloud.url', e.target.value.trim());
  $('#sandbox-cloud-id').onchange = (e) => save('sandbox.cloud.sandboxId', e.target.value.trim());
  $('#sandbox-cloud-key').onchange = (e) => { if (e.target.value) { save('sandbox.cloud.apiKey', e.target.value); e.target.value = ''; } };
  // ---- F28 a2a ----
  $('#a2a-enabled').onchange = async (e) => {
    const r = await rpc('a2a.enable', { enabled: e.target.checked });
    $('#a2a-msg').textContent = r.url ? ('serving at ' + r.url) : 'disabled';
  };
});
