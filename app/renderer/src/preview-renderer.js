// Shared, capability-free preview renderer. invoke returns an unwrapped daemon
// result. Untrusted document markup is never attached to the application DOM.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  pickPreviewKind, textPreviewFormat, MAX_PREVIEW_BYTES,
  MAX_PREVIEW_PAGES, MAX_PREVIEW_SHEETS, MAX_PREVIEW_TEXT,
} from '../../shared/preview-kind.js';

const MAX_SHEET_ROWS = 2000;
const MAX_SHEET_COLUMNS = 100;
const MAX_CANVAS_PIXELS = 4000000;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 4096;
const MAX_IMAGE_PIXELS = 16000000;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z0-9+/=\r\n]+$/i;
const CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'";
const SAFE_STYLE = /^(?:color|background-color|font(?:-size|-family|-weight|-style)?|line-height|text(?:-align|-decoration|-indent|-transform)|white-space|word-break|overflow-wrap|border(?:-(?:top|right|bottom|left))?(?:-width|-style|-color|-collapse|-spacing|-radius)?|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|width|height|min-width|max-width|min-height|max-height|display|vertical-align|list-style-type|opacity|position|left|top|right|bottom|transform|transform-origin|overflow|box-sizing)$/;
const TAGS = ['p', 'div', 'span', 'section', 'article', 'header', 'footer', 'main', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'img', 'a'];

function safeDeclarations(style) {
  const result = [];
  for (const name of Array.from({ length: style.length }, (_, i) => style[i])) {
    const value = style.getPropertyValue(name);
    // CSS escapes/comments/functions can hide URL loads; keep only a deliberately
    // small, static subset. No fixed positioning, animations or CSS variables.
    if (name === 'position' && !/^(?:static|relative|absolute)$/.test(value)) continue;
    if (SAFE_STYLE.test(name) && !/[\\@{}<>]|\/\*|\*\/|url\s*\(|expression\s*\(|image\s*\(|image-set\s*\(|var\s*\(/i.test(value)) {
      result.push(`${name}:${value}`);
    }
  }
  return result.join(';');
}

function safeStylesheet(text, document) {
  const Sheet = document.defaultView?.CSSStyleSheet || globalThis.CSSStyleSheet;
  if (!Sheet) return '';
  try {
    const sheet = new Sheet();
    sheet.replaceSync(text);
    return [...sheet.cssRules].filter((r) => r.type === 1 && /^[a-z0-9\s.#,:*>+~\[\]="'_-]+$/i.test(r.selectorText))
      .map((r) => `${r.selectorText}{${safeDeclarations(r.style)}}`).join('\n');
  } catch { return ''; }
}

function safeMarkup(html, document) {
  // A template has inert contents (including images), unlike a detached div.
  const template = document.createElement('template');
  template.innerHTML = String(html);
  const css = [...template.content.querySelectorAll('style')]
    .map((el) => safeStylesheet(el.textContent, document)).join('\n');
  const clean = DOMPurify.sanitize(template.innerHTML, {
    ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ['style', 'class', 'colspan', 'rowspan', 'width', 'height', 'alt', 'title', 'src'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['svg', 'math', 'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base', 'video', 'audio', 'source'],
  });
  for (const el of clean.querySelectorAll('*')) {
    if (el.hasAttribute('style')) {
      const style = safeDeclarations(el.style);
      if (style) el.setAttribute('style', style); else el.removeAttribute('style');
    }
    if (el.hasAttribute('src') && !(el.tagName === 'IMG' && DATA_IMAGE.test(el.getAttribute('src')))) el.removeAttribute('src');
    // href, srcset, target, ping, download, event handlers and all form/URI
    // attributes are absent from the allowlist. Anchors become inert labels.
  }
  const box = document.createElement('div');
  box.append(clean);
  return { html: box.innerHTML, css };
}

function frameFor(html, document, label = '安全文档预览') {
  const clean = safeMarkup(html, document);
  const frame = document.createElement('iframe');
  frame.className = 'preview-document';
  frame.title = label;
  frame.setAttribute('sandbox', '');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
  frame.style.cssText = 'width:100%;height:100%;min-height:420px;border:0;background:white;color:black';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>body{margin:20px;font:15px/1.6 system-ui;color:#202124;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}th,td{border:1px solid #ddd;padding:5px}pre{white-space:pre-wrap}section{margin-bottom:24px}${clean.css}</style></head><body>${clean.html}</body></html>`;
  return frame;
}

function message(document, text) {
  const el = document.createElement('div');
  el.className = 'preview-info';
  el.textContent = text;
  return el;
}

function rasterMime(bytes) {
  const at = (...v) => v.every((n, i) => bytes[i] === n);
  if (at(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (at(255, 216, 255)) return 'image/jpeg';
  if (at(71, 73, 70, 56)) return 'image/gif';
  if (at(66, 77)) return 'image/bmp';
  if (at(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

// Validate OOXML resources before handing them to third-party DOM renderers.
// Detached elements alone are NOT a network/XSS boundary.
async function officeArchive(bytes) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files);
  if (files.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Office 包超过 ${MAX_ARCHIVE_ENTRIES} 项限制`);
  let total = 0;
  for (const file of files) {
    // JSZip exposes central-directory sizes before inflation. Fail closed if
    // that bounded-size evidence is unavailable for a non-directory entry.
    const size = file.dir ? 0 : file._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('无法验证 Office 解压大小');
    total += size;
    if (total > MAX_ARCHIVE_BYTES) throw new Error('Office 解压内容超过 64 MiB 限制');
  }
  return zip;
}

async function xmlPart(zip, path) {
  const file = zip.file(path);
  if (!file) throw new Error(`Office 缺少 ${path}`);
  const text = await file.async('string');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Office XML 不允许 DTD/实体');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('Office XML 损坏');
  return xml;
}

function descendants(node, name) { return [...node.getElementsByTagNameNS('*', name)]; }
function attr(node, name) { return [...node.attributes].find((a) => a.localName === name)?.value || ''; }

async function preparedOffice(job, bytes, kind) {
  const zip = await officeArchive(bytes);
  let filtered = false;
  for (const file of Object.values(zip.files)) {
    job.current();
    if (file.dir) continue;
    if (/\.(?:xml|rels)$/i.test(file.name)) {
      const xml = await xmlPart(zip, file.name);
      // PPTX's text renderer uses innerHTML for text nodes. Encode literal HTML
      // metacharacters one extra time so its assignment still produces text.
      if (kind === 'pptx') for (const node of descendants(xml, 't')) {
        node.textContent = node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      for (const rel of descendants(xml, 'Relationship')) {
        const target = attr(rel, 'Target');
        if (attr(rel, 'TargetMode').toLowerCase() === 'external' || /^[a-z]+:|^[\/]|[?#]/i.test(target)) {
          rel.remove(); filtered = true;
        }
      }
      for (const node of [...xml.getElementsByTagName('*')]) {
        if (['altChunk', 'OLEObject', 'object', 'videoFile', 'audioFile', 'hlinkClick', 'hlinkHover', 'svgBlip'].includes(node.localName)) {
          node.remove(); filtered = true;
        }
        // Reject CSS/HTML/URL metacharacters before the libraries can turn an
        // attribute into a style, element ID, URL or drawing expression.
        for (const a of [...node.attributes]) {
          if (a.name.startsWith('xmlns')) continue;
          if (node.localName === 'Relationship' && a.localName === 'Type' && /^https?:\/\/schemas\.(?:openxmlformats\.org|microsoft\.com)\//.test(a.value)) continue;
          if (/[<>\{};]|url\s*\(|expression\s*\(|(?:https?|file|javascript|data):/i.test(a.value)) {
            node.removeAttributeNode(a); filtered = true;
          }
        }
      }
      zip.file(file.name, new XMLSerializer().serializeToString(xml));
    } else if (/\/(?:media)\//i.test(file.name) || /thumbnail\./i.test(file.name)) {
      const image = await file.async('uint8array');
      if (!rasterMime(image)) { zip.remove(file.name); filtered = true; }
    } else if (/embeddings|vbaProject|activeX/i.test(file.name)) {
      zip.remove(file.name); filtered = true;
    }
  }
  if (filtered) job.warn('Office 中的外部资源、活动内容或非位图媒体已移除');
  return { zip, bytes: await zip.generateAsync({ type: 'uint8array' }) };
}

let pptxQueue = Promise.resolve();
async function serializedPptx(job, action) {
  const previous = pptxQueue;
  let unlock;
  pptxQueue = new Promise((resolve) => { unlock = resolve; });
  await previous;
  try { job.current(); return await action(); } finally { unlock(); }
}

async function renderOffice(job, bytes, kind) {
  const prepared = await preparedOffice(job, bytes, kind);
  job.current();
  // Use an inert HTMLDocument: no browsing context, frame/preload or fetch
  // capability. Only the sanitized serialized result reaches the live page.
  const inert = job.document.implementation.createHTMLDocument('');
  const host = inert.createElement('div');
  inert.body.append(host);
  if (kind === 'docx') {
    const { renderAsync } = await import('docx-preview');
    job.current();
    await renderAsync(prepared.bytes, host, host, {
      inWrapper: true, ignoreFonts: true, useBase64URL: true,
      renderAltChunks: false, renderComments: false, experimental: false,
    });
    job.current();
    const pages = [...host.querySelectorAll('section.docx')];
    if (pages.length > MAX_PREVIEW_PAGES) {
      job.warn(`DOCX 共 ${pages.length} 页，仅显示前 ${MAX_PREVIEW_PAGES} 页`);
      for (const page of pages.slice(MAX_PREVIEW_PAGES)) page.remove();
    }
  } else {
    const mod = await import('pptx-preview');
    job.current();
    const init = mod.init || mod.default?.init;
    if (!init) throw new Error('pptx-preview: init() not found');
    // The library has a module-global event bus. Serialize use, and destroy
    // immediately after snapshotting, not later when another viewer is active.
    await serializedPptx(job, async () => {
      const viewer = init(host, { width: 960, height: 540, mode: 'list' });
      try {
        await viewer.load(prepared.bytes.buffer);
        job.current();
        const count = viewer.slideCount;
        if (!Number.isInteger(count) || count < 1) throw new Error('PPTX 未包含可渲染幻灯片或文件损坏');
        if (count > MAX_PREVIEW_PAGES) job.warn(`幻灯片共 ${count} 页，仅显示前 ${MAX_PREVIEW_PAGES} 页`);
        for (let i = 0; i < Math.min(count, MAX_PREVIEW_PAGES); i++) {
          job.current(); viewer.htmlRender.renderSlide(i);
        }
      } finally {
        for (const value of Object.values(viewer.pptx?.medias || {})) {
          if (typeof value === 'string' && value.startsWith('blob:')) URL.revokeObjectURL(value);
        }
        viewer.destroy();
      }
    });
    job.warn('PPTX 为安全静态预览，动画、交互与非位图绘图可能省略');
  }
  job.current();
  job.host.append(frameFor(host.innerHTML, job.document));
}

async function renderSheet(job, bytes) {
  const XLSX = await import('xlsx');
  job.current();
  // Bound parser work as well as output. Never materialize a gigantic !ref as
  // HTML; formulas/hyperlinks/macros are not executed and formatting is escaped.
  if (bytes[0] === 80 && bytes[1] === 75) await officeArchive(bytes);
  const wb = XLSX.read(bytes, { type: 'array', sheetRows: MAX_SHEET_ROWS, cellHTML: false, cellStyles: false, bookVBA: false });
  const content = job.document.createElement('div');
  if (wb.SheetNames.length > MAX_PREVIEW_SHEETS) job.warn(`共 ${wb.SheetNames.length} 个工作表，仅显示前 ${MAX_PREVIEW_SHEETS} 个`);
  for (const name of wb.SheetNames.slice(0, MAX_PREVIEW_SHEETS)) {
    job.current();
    const sheet = wb.Sheets[name];
    const h = job.document.createElement('h3'); h.textContent = name; content.append(h);
    if (!sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const fullRange = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    if (sheet['!fullref'] || fullRange.e.r >= MAX_SHEET_ROWS) job.warn(`工作表 ${name} 最多显示 ${MAX_SHEET_ROWS} 行`);
    if (fullRange.e.c >= MAX_SHEET_COLUMNS) job.warn(`工作表 ${name} 最多显示 ${MAX_SHEET_COLUMNS} 列`);
    range.e.r = Math.min(range.e.r, MAX_SHEET_ROWS - 1);
    range.e.c = Math.min(range.e.c, MAX_SHEET_COLUMNS - 1);
    sheet['!ref'] = XLSX.utils.encode_range(range);
    // SheetJS encodes cell text, but still sanitize generated links and markup.
    const clean = safeMarkup(XLSX.utils.sheet_to_html(sheet, { header: '', footer: '', editable: false }), job.document);
    const template = job.document.createElement('template'); template.innerHTML = clean.html; content.append(template.content);
  }
  job.host.append(frameFor(content.innerHTML, job.document));
}

async function renderPdf(job, bytes) {
  const pdfjs = await import('pdfjs-dist');
  job.current();
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
  job.current();
  const task = pdfjs.getDocument({
    data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    useWorkerFetch: false, disableAutoFetch: true, disableStream: true,
  });
  job.own(() => task.destroy());
  const doc = await task.promise;
  job.current();
  if (doc.numPages > MAX_PREVIEW_PAGES) job.warn(`PDF 共 ${doc.numPages} 页，仅显示前 ${MAX_PREVIEW_PAGES} 页`);
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PREVIEW_PAGES); i++) {
    const page = await doc.getPage(i);
    job.current();
    const natural = page.getViewport({ scale: 1.4 });
    const scale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (natural.width * natural.height)));
    if (scale < 1) job.warn('超大 PDF 页面已缩小至每页 400 万像素');
    const viewport = page.getViewport({ scale: 1.4 * scale });
    const canvas = job.document.createElement('canvas');
    canvas.className = 'pdf-page'; canvas.width = viewport.width; canvas.height = viewport.height;
    job.own(() => { canvas.width = 0; canvas.height = 0; });
    const render = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    const release = job.own(() => render.cancel());
    try { await render.promise; } finally { release(); page.cleanup(); }
    job.current(); job.host.append(canvas);
  }
}

async function renderImage(job, bytes) {
  const mime = rasterMime(bytes);
  if (!mime) throw new Error('图片内容不是受支持的位图（SVG 和伪装文件已拒绝）');
  const view = job.document.defaultView || globalThis;
  const url = view.URL.createObjectURL(new Blob([bytes], { type: mime }));
  job.own(() => view.URL.revokeObjectURL(url));
  const image = job.document.createElement('img');
  image.className = 'preview-image'; image.alt = job.path;
  image.src = url;
  await image.decode();
  job.current();
  if (image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) throw new Error('图片超过 1600 万像素预览限制');
  job.host.append(image);
}

async function render(job, bytes, source) {
  if (job.kind === 'text') {
    const raw = new TextDecoder().decode(bytes);
    const text = raw.slice(0, MAX_PREVIEW_TEXT);
    if (raw.length > text.length) job.warn(`文本共 ${raw.length} 字符，仅显示前 ${MAX_PREVIEW_TEXT} 字符`);
    const format = source ? 'text' : textPreviewFormat(job.path);
    if (format === 'text') {
      const pre = job.document.createElement('pre'); pre.className = 'preview-text'; pre.textContent = text; job.host.append(pre);
    } else job.host.append(frameFor(format === 'markdown' ? marked.parse(text, { async: false }) : text, job.document));
  } else if (job.kind === 'image') await renderImage(job, bytes);
  else if (job.kind === 'pdf') await renderPdf(job, bytes);
  else if (job.kind === 'sheet') await renderSheet(job, bytes);
  else await renderOffice(job, bytes, job.kind);
}

/**
 * load(path, {source:false}={}) -> Promise<{path,kind,ok,error,bytes,warning?}>.
 * Superseded/destroyed loads resolve ok:false; they never modify the host.
 * destroy() is terminal, invalidates pending work and releases all owned resources.
 */
export function createPreviewController(container, invoke) {
  if (!container?.ownerDocument || typeof invoke !== 'function') throw new TypeError('预览需要 DOM 容器和 invoke');
  const document = container.ownerDocument;
  let generation = 0;
  let destroyed = false;
  let active = null;
  let pending = null;

  function makeJob(path, kind, version) {
    const resources = new Set();
    let disposed = false;
    const warnings = new Set();
    const job = {
      path, kind, document, host: document.createElement('div'),
      current() { if (destroyed || generation !== version || disposed) throw new Error('预览加载已失效'); },
      warn(text) { warnings.add(text); },
      warning() { return [...warnings].join('；'); },
      own(cleanup) {
        let released = false;
        const release = () => {
          if (released) return;
          released = true; resources.delete(release);
          try { Promise.resolve(cleanup()).catch(() => {}); } catch { /* best-effort cleanup */ }
        };
        if (disposed) release(); else resources.add(release);
        return release;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const release of [...resources]) release();
        // Removing srcdoc destroys the isolated document, too.
        for (const frame of job.host.querySelectorAll('iframe')) frame.removeAttribute('srcdoc');
        job.host.replaceChildren();
      },
    };
    job.host.className = 'preview-content';
    job.host.style.cssText = 'height:100%;min-height:0';
    return job;
  }

  async function load(path, { source = false } = {}) {
    path = String(path || '');
    const kind = pickPreviewKind(path);
    const state = { path, kind, ok: false, error: null, bytes: 0 };
    if (destroyed) return { ...state, error: '预览控制器已销毁' };
    const version = ++generation;
    pending?.dispose();
    active?.dispose(); active = null;
    const job = pending = makeJob(path, kind, version);
    // Never leave the previous target visible while a new target is loading.
    container.replaceChildren(message(document, '正在加载预览…'));
    container.setAttribute('aria-busy', 'true');
    try {
      if (!path) throw new Error('未指定预览路径');
      if (kind === 'unsupported') throw new Error(`此文件类型暂不支持预览: ${path}`);
      const meta = await invoke('files.readBinary', { path, maxBytes: MAX_PREVIEW_BYTES });
      job.current();
      state.bytes = Number(meta?.size) || 0;
      if (state.bytes > MAX_PREVIEW_BYTES) throw new Error('文件超过 25 MiB 预览大小限制');
      if (typeof meta?.base64 !== 'string' || meta.base64.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4) throw new Error('无效或超过 25 MiB 的文件内容');
      const bytes = Uint8Array.from(atob(meta.base64), (c) => c.charCodeAt(0));
      if (bytes.length > MAX_PREVIEW_BYTES) throw new Error('文件超过 25 MiB 预览大小限制');
      if (state.bytes !== bytes.length) throw new Error('文件大小与预览内容不一致');
      await render(job, bytes, source);
      job.current();
      state.ok = true;
      if (job.warning()) state.warning = job.warning();
      container.replaceChildren(job.host);
      active = job; pending = null;
    } catch (error) {
      state.error = String(error?.message || error);
      if (error?.code === 'too_large' || /file too large|25 MiB/.test(state.error)) {
        state.error = '文件超过 25 MiB 预览大小限制';
      }
      if (/限制/.test(state.error)) state.warning = state.error;
      job.dispose();
      if (!destroyed && generation === version) {
        container.replaceChildren(message(document, `预览失败: ${state.error}`)); pending = null;
      }
    } finally {
      if (!destroyed && generation === version) container.removeAttribute('aria-busy');
    }
    return state;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true; generation++;
    pending?.dispose(); active?.dispose(); pending = active = null;
    container.replaceChildren(); container.removeAttribute('aria-busy');
  }
  return { load, destroy };
}
