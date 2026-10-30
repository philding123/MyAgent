// Independent preview window: the same controller is used by the artifact panel.
import { createPreviewController } from './preview-renderer.js';
import { textPreviewFormat, mimeForExt } from '../../shared/preview-kind.js';

async function rpc(method, params) {
  const response = await window.myagent.invoke(method, params);
  if (!response.ok) throw new Error(response.error?.message || 'rpc error');
  return response.result;
}

function main() {
  const file = new URLSearchParams(location.search).get('path') || '';
  const name = file.split(/[\\/]/).pop();
  document.title = 'MyAgent Preview — ' + name;
  document.getElementById('preview-title').textContent = name;
  const controller = createPreviewController(document.getElementById('preview-container'), rpc);
  const toggle = document.getElementById('preview-source');
  const warning = document.getElementById('preview-warning');
  toggle.hidden = textPreviewFormat(file) === 'text';
  let source = false;
  let revision = 0;

  async function load() {
    const current = ++revision;
    window.__previewState = { path: file, kind: null, ok: false, error: null, bytes: 0 };
    warning.hidden = true; warning.textContent = '';
    toggle.textContent = source ? '成品' : '源码';
    toggle.setAttribute('aria-pressed', String(source));
    const state = await controller.load(file, { source });
    if (current !== revision) return;
    document.getElementById('preview-kind').textContent = `${state.kind} · ${mimeForExt(file)}`;
    warning.textContent = state.warning || '';
    warning.hidden = !state.warning;
    // Existing T20 smoke hook: always publish the latest target only.
    window.__previewState = state;
  }

  toggle.addEventListener('click', () => { source = !source; void load(); });
  // F60: frameless window — its own controls act on this window (win-self)
  const self = (op) => () => window.myagent.windowAction('win-self', { op });
  document.getElementById('pv-min').addEventListener('click', self('minimize'));
  document.getElementById('pv-max').addEventListener('click', self('maximize'));
  document.getElementById('pv-close').addEventListener('click', self('close'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) self('close')(); });
  window.addEventListener('pagehide', () => { revision++; controller.destroy(); }, { once: true });
  void load();
}

// Follow persisted theme without exposing any bridge to preview documents.
window.myagent.windowAction('theme').then((theme) => { if (theme) document.body.dataset.theme = theme; });
window.myagent.onEvent((msg) => { if (msg.topic === 'app:theme') document.body.dataset.theme = msg.payload.theme; });
window.addEventListener('DOMContentLoaded', main);
