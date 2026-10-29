'use strict';
// Shared pure helpers for F19/F20: mermaid block extraction and preview kind
// detection. CJS so plain-node unit tests can require it and esbuild can
// import it from ESM renderer sources.

const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_PAGES = 50;
const MAX_PREVIEW_SHEETS = 12;
const MAX_PREVIEW_TEXT = 200000;

function previewExtension(filename) {
  const name = String(filename || '').split(/[\\/]/).pop();
  return /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() || '';
}

// Keep the historical `text` kind (including Markdown/HTML) for callers and
// smoke hooks; the shared renderer selects the rich-text mode separately.
function textPreviewFormat(filename) {
  const ext = previewExtension(filename);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'html' || ext === 'htm') return 'html';
  return 'text';
}

/** Extract fenced ```mermaid blocks from markdown source. */
function extractMermaidBlocks(markdown) {
  const out = [];
  const lines = String(markdown || '').split(/\r?\n/);
  let inFence = false;
  let lang = '';
  let buf = [];
  for (const line of lines) {
    const fence = line.match(/^\s*```\s*([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      if (!inFence) { inFence = true; lang = fence[1].toLowerCase(); buf = []; }
      else {
        if (lang === 'mermaid' && buf.join('\n').trim()) out.push(buf.join('\n'));
        inFence = false; lang = ''; buf = [];
      }
      continue;
    }
    if (inFence) buf.push(line);
  }
  return out;
}

/** Map a filename to a preview renderer kind (F20). */
function pickPreviewKind(filename) {
  const ext = previewExtension(filename);
  if (!ext) return 'unsupported';
  const table = {
    docx: 'docx',
    pdf: 'pdf',
    xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', csv: 'sheet',
    pptx: 'pptx',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
    // SVG is active XML, not a raster image. Deliberately unsupported.
    txt: 'text', md: 'text', markdown: 'text', json: 'text', log: 'text', js: 'text', ts: 'text', py: 'text',
    html: 'text', htm: 'text', css: 'text', xml: 'text', yml: 'text', yaml: 'text',
  };
  return table[ext] || 'unsupported';
}

function mimeForExt(filename) {
  const ext = previewExtension(filename);
  const table = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    pdf: 'application/pdf',
    txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json', csv: 'text/csv',
    html: 'text/html', htm: 'text/html', xml: 'application/xml',
  };
  return table[ext] || 'application/octet-stream';
}

module.exports = {
  extractMermaidBlocks, pickPreviewKind, mimeForExt, textPreviewFormat,
  MAX_PREVIEW_BYTES, MAX_PREVIEW_PAGES, MAX_PREVIEW_SHEETS, MAX_PREVIEW_TEXT,
};
