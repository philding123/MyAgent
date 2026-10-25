import { createPreviewController } from './preview-renderer.js';

const keyFor = (artifact) => artifact.location + ':' + artifact.path;

export class ArtifactCenter {
  constructor({ rpc, windowAction }) {
    this.rpc = rpc;
    this.windowAction = windowAction;
    this.sessions = new Map();
    this.sessionId = null;
    this.generation = 0;
    this.source = false;
    this.panel = document.getElementById('artifact-panel');
    this.toggle = document.getElementById('btn-artifacts');
    this.list = document.getElementById('artifact-list');
    this.status = document.getElementById('artifact-status');
    this.previewHost = document.getElementById('artifact-preview');
    this.preview = createPreviewController(this.previewHost, rpc);
    this.toggle.onclick = () => this.setExpanded(!this.state?.expanded, true);
    document.getElementById('artifact-close').onclick = () => {
      this.setExpanded(false, true);
      this.toggle.focus();
    };
    document.getElementById('artifact-source').onclick = () => {
      this.source = !this.source;
      document.getElementById('artifact-source').setAttribute('aria-pressed', String(this.source));
      if (this.selected) this.show(this.selected);
    };
    for (const operation of ['reveal', 'open', 'copy', 'window']) {
      document.getElementById('artifact-' + operation).onclick = () => this.act(operation);
    }
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.setExpanded(false, true);
        this.toggle.focus();
      }
    });
    this.render();
  }

  get state() { return this.sessions.get(this.sessionId); }
  get selected() { return this.state?.items.get(this.state.selected); }

  setSession(id, records = []) {
    this.generation++;
    this.preview.destroy();
    this.preview = createPreviewController(this.previewHost, this.rpc);
    this.sessionId = id;
    this.source = false;
    if (id) {
      const previous = this.sessions.get(id);
      const items = new Map();
      for (const artifact of records) {
        if (artifact && artifact.path && artifact.sessionId === id) items.set(keyFor(artifact), artifact);
      }
      this.sessions.set(id, {
        items, selected: previous?.selected || null,
        expanded: previous?.expanded || false, userCollapsed: previous?.userCollapsed || false,
      });
      if (!items.has(this.state.selected)) this.state.selected = items.keys().next().value || null;
      for (const artifact of items.values()) this.chatCard(artifact);
    }
    this.status.textContent = '';
    this.status.dataset.state = '';
    this.render();
    if (this.state?.expanded && this.selected) this.show(this.selected);
  }

  beginTurn() {
    if (this.state) this.state.userCollapsed = false;
  }

  add(artifact) {
    if (!this.state || !artifact?.path) return;
    if (artifact.sessionId && artifact.sessionId !== this.sessionId) return;
    artifact = { location: 'local', kind: 'working', ...artifact, sessionId: this.sessionId };
    const key = keyFor(artifact);
    this.state.items.set(key, artifact);
    this.chatCard(artifact);
    if (!this.state.selected || artifact.kind === 'delivered') this.state.selected = key;
    this.render();
    if (artifact.kind === 'delivered' && !this.state.userCollapsed) this.setExpanded(true);
    else if (this.state.expanded && this.state.selected === key) this.show(artifact);
  }

  chatCard(artifact) {
    const messages = document.getElementById('messages');
    let grid = messages.querySelector('.artifact-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'artifact-grid';
      messages.appendChild(grid);
    }
    const key = keyFor(artifact);
    let card = [...grid.children].find((entry) => entry.dataset.artifactKey === key);
    if (!card) {
      card = document.createElement('button');
      card.className = 'artifact-card';
      card.dataset.artifactKey = key;
      const icon = document.createElement('span');
      icon.className = 'af-ico';
      icon.textContent = '▤';
      const name = document.createElement('span');
      name.className = 'af-name';
      card.append(icon, name);
      grid.appendChild(card);
    }
    card.querySelector('.af-name').textContent = artifact.name || artifact.path.split(/[\\/]/).pop();
    card.title = artifact.path;
    card.onclick = () => {
      this.state.selected = key;
      this.setExpanded(true, true);
    };
  }

  setExpanded(expanded, user = false) {
    if (!this.state) return;
    this.state.expanded = !!expanded;
    if (user) this.state.userCollapsed = !expanded;
    this.render();
    if (expanded && this.selected) this.show(this.selected);
    else {
      this.generation++;
      this.preview.destroy();
    this.preview = createPreviewController(this.previewHost, this.rpc);
    }
  }

  render() {
    const items = this.state?.items || new Map();
    this.toggle.textContent = '产物' + (items.size ? ' · ' + items.size : '');
    this.toggle.disabled = !this.sessionId;
    this.toggle.setAttribute('aria-expanded', String(!!this.state?.expanded));
    this.panel.classList.toggle('hidden', !this.state?.expanded);
    this.list.replaceChildren();
    if (!items.size) {
      const empty = document.createElement('p');
      empty.className = 'artifact-empty';
      empty.textContent = '本会话暂无产物。成功写入或交付的文件会显示在这里。';
      this.list.appendChild(empty);
    }
    for (const [key, artifact] of items) {
      const button = document.createElement('button');
      button.className = 'artifact-item' + (this.state.selected === key ? ' active' : '');
      button.setAttribute('aria-pressed', String(this.state.selected === key));
      const name = document.createElement('span');
      name.textContent = artifact.name;
      const kind = document.createElement('small');
      kind.textContent = artifact.location === 'remote' ? '远端文件' : artifact.kind === 'delivered' ? '已交付' : '工作文件';
      button.append(name, kind);
      button.title = artifact.path;
      button.onclick = () => {
        this.state.selected = key;
        this.source = false;
        this.render();
        this.show(artifact);
      };
      this.list.appendChild(button);
    }
    document.getElementById('artifact-name').textContent = this.selected?.name || '选择一个产物';
    document.getElementById('artifact-path').textContent = this.selected?.path || '';
    document.getElementById('artifact-source').setAttribute('aria-pressed', String(this.source));
    for (const button of this.panel.querySelectorAll('.artifact-actions button')) {
      button.disabled = !this.selected || this.selected.location === 'remote';
    }
  }

  async show(artifact) {
    const generation = ++this.generation;
    this.preview.destroy();
    this.preview = createPreviewController(this.previewHost, this.rpc);
    this.status.dataset.state = 'loading';
    this.status.textContent = artifact.location === 'remote' ? '远端文件暂不支持本机预览与路径操作。' : '正在加载…';
    if (artifact.location === 'remote') return;
    const sessionId = this.sessionId;
    try {
      const file = await this.rpc('artifacts.resolve', { sessionId, path: artifact.path, operation: 'preview' });
      if (generation !== this.generation) return;
      const state = await this.preview.load(file.path, { source: this.source });
      if (generation !== this.generation) return;
      this.status.textContent = state.ok ? (state.warning || '') : '预览失败：' + (state.error || '不支持此文件类型');
      this.status.dataset.state = state.ok ? 'ready' : 'error';
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.textContent = '无法访问产物：' + error.message;
      this.status.dataset.state = 'error';
    }
  }

  async act(operation) {
    const artifact = this.selected;
    if (!artifact || artifact.location === 'remote') return;
    const sessionId = this.sessionId;
    const generation = this.generation;
    try {
      if (operation === 'window') {
        const file = await this.rpc('artifacts.resolve', { sessionId, path: artifact.path, operation: 'preview' });
        await this.windowAction('openPreview', { path: file.path });
      } else {
        const result = await this.windowAction('artifactAction', { sessionId, path: artifact.path, operation });
        if (!result?.ok) throw new Error(result?.error?.message || '文件操作失败');
      }
      if (generation === this.generation) this.status.textContent = {
        copy: '已复制完整路径', reveal: '已请求在文件管理器中定位', open: '已请求使用默认应用打开', window: '已在独立窗口打开',
      }[operation];
    } catch (error) {
      if (generation === this.generation) this.status.textContent = error.message;
    }
  }
}
