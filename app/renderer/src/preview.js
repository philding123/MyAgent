// Preview window entry (F20). Loads a file through the daemon (sandbox-checked
// readBinary), picks a renderer by extension, renders into #preview-container.
// Renderers are lazy-imported so the window paints before heavy libs load.

import { pickPreviewKind, mimeForExt, MAX_PREVIEW_BYTES } from '../../shared/preview-kind.js';

const state = { path: null, kind: null, ok: false, error: null, bytes: 0 };

async function rpc(method, params) {
  const r = await window.myagent.invoke(method, params);
  if (!r.ok) throw new Error((r.error && r.error.message) || 'rpc error');
  return r.result;
}

function container() { return document.getElementById('preview-container'); }

function info(msg) {
  container().innerHTML = '<div class="preview-info">' + String(msg).replace(/[<>&]/g, '') + '</div>';
}

async function main() {
  const params = new URLSearchParams(location.search);
  const file = params.get('path') || '';
  document.title = 'MyAgent Preview — ' + file.split(/[\\/]/).pop();
  document.getElementById('preview-title').textContent = file.split(/[\\/]/).pop();
  state.path = file;
  try {
    const meta = await rpc('files.readBinary', { path: file, maxBytes: MAX_PREVIEW_BYTES });
    state.kind = pickPreviewKind(file);
    state.bytes = meta.size;
    document.getElementById('preview-kind').textContent = state.kind + ' · ' + meta.mime;
    const buf = Uint8Array.from(atob(meta.base64), (c) => c.charCodeAt(0));
    if (state.kind === 'docx') await renderDocx(buf);
    else if (state.kind === 'pdf') await renderPdf(buf);
    else if (state.kind === 'sheet') await renderSheet(buf, file);
    else if (state.kind === 'pptx') await renderPptx(buf);
    else if (state.kind === 'image') renderImage(buf, meta.mime);
    else if (state.kind === 'text') renderText(buf);
    else info('此文件类型暂不支持预览: ' + file);
    state.ok = true;
  } catch (e) {
    state.error = String(e && e.message || e);
    info('预览失败: ' + state.error);
  } finally {
    // smoke hook (T20)
    window.__previewState = state;
  }
}

async function renderDocx(buf) {
  const { renderAsync } = await import('docx-preview');
  container().innerHTML = '';
  const host = document.createElement('div');
  host.className = 'docx-host';
  container().appendChild(host);
  await renderAsync(buf, host, undefined, { inWrapper: true, ignoreFonts: true });
}

async function renderPdf(buf) {
  const pdfjs = await import('pdfjs-dist');
  // main-thread "fake worker": file:// pages cannot reliably spawn module
  // workers, so preload the worker module into the global pdfjs looks at.
  if (!globalThis.pdfjsWorker) {
    globalThis.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
  }
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  container().innerHTML = '';
  for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    container().appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
}

async function renderSheet(buf, file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  container().innerHTML = '';
  for (const name of wb.SheetNames.slice(0, 12)) {
    const h = document.createElement('h3');
    h.textContent = name;
    container().appendChild(h);
    const wrap = document.createElement('div');
    wrap.className = 'sheet-table';
    wrap.innerHTML = XLSX.utils.sheet_to_html(wb.Sheets[name], { header: '', footer: '' });
    container().appendChild(wrap);
  }
}

async function renderPptx(buf) {
  const mod = await import('pptx-preview');
  container().innerHTML = '';
  const init = mod.init || mod.default && mod.default.init;
  if (!init) throw new Error('pptx-preview: init() not found');
  const viewer = init(container(), { width: 960, height: 540 });
  await viewer.preview(buf.buffer);
}

function renderImage(buf, mime) {
  const blob = new Blob([buf], { type: mime || 'image/png' });
  container().innerHTML = '';
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  img.className = 'preview-image';
  container().appendChild(img);
}

function renderText(buf) {
  info('');
  const pre = document.createElement('pre');
  pre.className = 'preview-text';
  pre.textContent = new TextDecoder().decode(buf).slice(0, 200000);
  container().innerHTML = '';
  container().appendChild(pre);
}

// F29: adopt the persisted theme and follow cross-window changes
window.myagent.windowAction('theme').then((t) => { if (t) document.body.dataset.theme = t; });
window.myagent.onEvent((msg) => { if (msg.topic === 'app:theme') document.body.dataset.theme = msg.payload.theme; });

window.addEventListener('DOMContentLoaded', main);
