'use strict';
// Shared pure helpers for F19/F20: mermaid block extraction and preview kind
// detection. CJS so plain-node unit tests can require it and esbuild can
// import it from ESM renderer sources.

const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

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
  const ext = String(filename || '').toLowerCase().replace(/^.*\./, '');
  if (!/[a-z0-9]/.test(ext) || String(filename || '').indexOf('.') === -1) return 'unsupported';
  const table = {
    docx: 'docx', doc: 'docx',
    pdf: 'pdf',
    xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', csv: 'sheet',
    pptx: 'pptx', ppt: 'pptx',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image',
    txt: 'text', md: 'text', json: 'text', log: 'text', js: 'text', ts: 'text', py: 'text',
    html: 'text', css: 'text', xml: 'text', yml: 'text', yaml: 'text',
  };
  return table[ext] || 'unsupported';
}

function mimeForExt(filename) {
  const ext = String(filename || '').toLowerCase().replace(/^.*\./, '');
  const table = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
    pdf: 'application/pdf',
    txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
    html: 'text/html', xml: 'application/xml',
  };
  return table[ext] || 'application/octet-stream';
}

module.exports = { extractMermaidBlocks, pickPreviewKind, mimeForExt, MAX_PREVIEW_BYTES };
