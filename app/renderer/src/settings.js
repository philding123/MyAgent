import DOMPurify from 'dompurify';
import { uiConfirm } from './ui-kit.js';

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
  $('#cu-chk').checked = all['computerUse.enable'] === true;
  const theme = await window.myagent.windowAction('theme') || 'light';
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

async function loadIm() {
  const channels = await rpc('im.status');
  const ul = $('#im-list');
  ul.innerHTML = '';
  for (const c of channels) {
    const li = document.createElement('li');
    li.textContent = c.id + ' — ' + c.status + (c.credential === 'missing' ? '（未配置 token）' : '') +
      (c.error ? ' · ' + c.error : '');
    ul.appendChild(li);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // F29: follow theme changes made in any other window
  window.myagent.onEvent((msg) => {
    if (msg.topic === 'app:theme') {
      document.body.dataset.theme = msg.payload.theme;
      $('#theme-select').value = msg.payload.theme;
    }
    if (msg.topic === 'settings:panel') {
      const b = document.querySelector(`.settings-navigation__item[data-panel="${msg.payload.panel}"]`);
      if (b) b.click();
    }
  });
  loadSettings().catch(() => {});
  loadSelfcheck().catch(() => {});
  loadSkills().catch(() => {});
  loadMemory().catch(() => {});
  loadIm().catch(() => {});
  loadTasks().catch(() => {});
  loadPresets().catch(() => {});
  loadLibrary().catch(() => {});

  const save = (k, v) => rpc('settings.set', { key: k, value: v }).catch(() => {});
  $('#llm-base').onchange = (e) => save('llm.baseUrl', e.target.value.trim());
  $('#llm-model').onchange = (e) => save('llm.model', e.target.value.trim());
  $('#llm-key').onchange = (e) => { if (e.target.value) { save('llm.apiKey', e.target.value); e.target.value = ''; } };
  $('#prewarm-chk').onchange = (e) => save('engine.prewarm', e.target.checked);
  // F59 (design/43): first-enable warning — screen captures ride to the
  // configured LLM endpoint; cancelling the dialog leaves the gate off
  $('#cu-chk').onchange = async (e) => {
    if (e.target.checked) {
      const ok = await uiConfirm({
        title: '开启电脑操控（computer use）？',
        body: '开启后代理可以截取屏幕、列出窗口并进行点击/键盘输入（改动类动作仅在 craft 模式放行）。\n使用中的屏幕截图会作为消息内容发送到「模型」面板配置的端点。',
        okText: '开启',
      });
      if (!ok) { e.target.checked = false; return; }
    }
    save('computerUse.enable', e.target.checked);
  };
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
    const ok = await uiConfirm({
      title: '清空所有数据？', body: '将删除全部会话与记忆，且无法恢复。', okText: '全部删除', danger: true,
    });
    if (!ok) return;
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
  // ---- F23 IM channels ----
  $('#btn-im-save').onclick = async () => {
    const channel = $('#im-channel').value;
    const token = $('#im-token').value.trim();
    if (!token) { $('#im-msg').textContent = 'token 为空'; return; }
    await rpc('im.setCredential', { channel, token });
    $('#im-token').value = '';
    $('#im-msg').textContent = channel + ' token 已入 vault';
    loadIm();
  };
  $('#btn-im-start').onclick = async () => {
    const channel = $('#im-channel').value;
    try {
      const r = await rpc('im.start', { channel });
      $('#im-msg').textContent = channel + ' → ' + r.state.status + (r.state.error ? ' (' + r.state.error + ')' : '');
    } catch (e) { $('#im-msg').textContent = 'fail: ' + e.message; }
    loadIm();
  };
  $('#btn-im-stop').onclick = async () => {
    const channel = $('#im-channel').value;
    await rpc('im.stop', { channel });
    $('#im-msg').textContent = channel + ' 已停止';
    loadIm();
  };

  // ---- F40 scheduled tasks (design/34) ----
  let selectedTask = null;
  async function loadTasks() {
    const list = await rpc('tasks.list');
    const ul = $('#task-list');
    ul.innerHTML = '';
    for (const t of list) {
      const li = document.createElement('li');
      li.textContent = (t.enabled ? '⏰ ' : '⏸ ') + t.name + ' — 每 ' + Math.max(1, Math.round(t.intervalMs / 60000)) + ' 分钟';
      li.onclick = () => { selectedTask = t.id; [...ul.children].forEach((x) => x.classList.remove('active')); li.classList.add('active'); };
      ul.appendChild(li);
    }
  }
  $('#btn-task-add').onclick = async () => {
    try {
      await rpc('tasks.create', { name: $('#task-name').value.trim(), prompt: $('#task-prompt').value, intervalMs: (Math.max(1, +$('#task-interval').value || 60)) * 60000 });
      $('#task-msg').textContent = '已创建';
      loadTasks();
    } catch (e) { $('#task-msg').textContent = e.message; }
  };
  $('#btn-task-remove').onclick = async () => { if (selectedTask) { await rpc('tasks.remove', { id: selectedTask }); selectedTask = null; loadTasks(); } };
  $('#btn-task-refresh').onclick = loadTasks;

  // ---- F41 presets (助理) ----
  let selectedPreset = null;
  async function loadPresets() {
    const list = await rpc('presets.list');
    const ul = $('#preset-list');
    ul.innerHTML = '';
    for (const p of list) {
      const li = document.createElement('li');
      li.textContent = p.name + (p.description ? ' — ' + p.description : '');
      li.onclick = () => { selectedPreset = p.id; [...ul.children].forEach((x) => x.classList.remove('active')); li.classList.add('active'); };
      ul.appendChild(li);
    }
  }
  $('#btn-preset-add').onclick = async () => {
    try {
      await rpc('presets.create', { name: $('#preset-name').value.trim(), prompt: $('#preset-prompt').value });
      $('#preset-msg').textContent = '已创建';
      $('#preset-name').value = ''; $('#preset-prompt').value = '';
      loadPresets();
    } catch (e) { $('#preset-msg').textContent = e.message; }
  };
  $('#btn-preset-remove').onclick = async () => { if (selectedPreset) { await rpc('presets.remove', { id: selectedPreset }); selectedPreset = null; loadPresets(); } };

  // ---- F42 library (资料库) ----
  let selectedLib = null;
  async function loadLibrary() {
    const list = await rpc('library.list');
    const ul = $('#lib-list');
    ul.innerHTML = '';
    for (const f of list) {
      const li = document.createElement('li');
      li.textContent = f.name + ' (' + f.size + 'B)';
      li.onclick = () => { selectedLib = f.name; [...ul.children].forEach((x) => x.classList.remove('active')); li.classList.add('active'); };
      ul.appendChild(li);
    }
  }
  $('#btn-lib-add').onclick = async () => {
    const file = await window.myagent.windowAction('pickFile');
    if (!file) return;
    await rpc('library.add', { path: file });
    loadLibrary();
  };
  $('#btn-lib-remove').onclick = async () => { if (selectedLib) { await rpc('library.remove', { name: selectedLib }); selectedLib = null; loadLibrary(); } };
  $('#btn-lib-refresh').onclick = loadLibrary;

  // ---- F52 connectors (wb「连接器」= MCP 客户端集成) ----
  async function loadConnectors() {
    const list = await rpc('connectors.list');
    const ul = $('#conn-list');
    ul.innerHTML = '';
    for (const c of list) {
      const li = document.createElement('li');
      const stateTag = c.state === 'connected' ? '已连接' : (c.state === 'error' ? '错误: ' + (c.error || '') : c.state);
      li.innerHTML = '<b></b> — <code></code> [' + stateTag + (c.tools.length ? '，' + c.tools.length + ' 工具' : '') + '] ';
      li.querySelector('b').textContent = c.name + (c.enabled === false ? '（停用）' : '');
      li.querySelector('code').textContent = c.command + ' ' + (c.args || []).join(' ');
      const tog = document.createElement('button');
      tog.textContent = c.enabled === false ? '启用' : '停用';
      tog.onclick = async () => { await rpc('connectors.toggle', { id: c.id, enabled: c.enabled === false }); loadConnectors(); };
      const del = document.createElement('button');
      del.textContent = '移除';
      del.onclick = async () => { await rpc('connectors.remove', { id: c.id }); loadConnectors(); };
      li.append(tog, ' ', del);
      ul.appendChild(li);
    }
    if (!list.length) ul.innerHTML = '<li>暂无连接器 — 添加一个 MCP 服务器（如 REA）即可把它的工具接进引擎</li>';
  }
  $('#btn-conn-add').onclick = async () => {
    $('#conn-msg').textContent = 'connecting…';
    try {
      let args = [];
      const raw = $('#conn-args').value.trim();
      if (raw) {
        args = JSON.parse(raw);
        if (!Array.isArray(args)) throw new Error('参数必须是 JSON 数组');
      }
      await rpc('connectors.add', { name: $('#conn-name').value.trim(), command: $('#conn-command').value.trim(), args });
      $('#conn-name').value = ''; $('#conn-command').value = ''; $('#conn-args').value = '';
      $('#conn-msg').textContent = '已添加并连接';
      loadConnectors();
    } catch (e) { $('#conn-msg').textContent = 'fail: ' + e.message; }
  };
  $('#btn-conn-refresh').onclick = loadConnectors;
  loadConnectors().catch(() => {});

  // ---- WorkBuddy settings layout (design/27 F31 / 33 v5.8.2): grouped nav,
  // search filter, ?panel= deep link, window chrome ----
  const activate = (b) => {
    document.querySelectorAll('.settings-navigation__item').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.settings-window-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.panel));
  };
  document.querySelectorAll('.settings-navigation__item').forEach((b) => { b.onclick = () => activate(b); });
  // ?panel= deep link, else the first panel — never an empty content area
  const panelParam = new URLSearchParams(location.search).get('panel');
  const first = document.querySelector('.settings-navigation__item');
  const target = (panelParam && document.querySelector(`.settings-navigation__item[data-panel="${panelParam}"]`)) || first;
  if (target) activate(target);
  $('#settings-search').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    document.querySelectorAll('.settings-navigation__item').forEach((b) => {
      b.style.display = !v || b.textContent.includes(v) ? '' : 'none';
    });
  });
  const closeBtn = $('#btn-close-settings');
  if (closeBtn) closeBtn.onclick = () => window.close();
  // Esc closes the window unless a dialog or a field is handling it
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.ui-backdrop')) return;
    window.close();
  });
});
