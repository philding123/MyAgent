'use strict';
// F43 @-context augmentation (design/34): pull `@"path"` tokens out of the
// user text, inline readable files (per-file cap), and note unreadable ones.
// The stored user message keeps the ORIGINAL text; only the engine sees the
// augmented text.

const fs = require('fs');

const MAX_FILE_BYTES = 64 * 1024;
const CTX_RE = /@"([^"]+)"/g;

function augmentContext(text, context = [], readFile = (p) => fs.readFileSync(p, 'utf8')) {
  const fromTokens = [...text.matchAll(CTX_RE)].map((m) => m[1]);
  const paths = [...new Set([...context, ...fromTokens])];
  let clean = text.replace(CTX_RE, '').replace(/ {2,}/g, ' ').trimEnd();
  if (!paths.length) return { text: clean || text, used: [] };
  let note = '';
  const used = [];
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) throw new Error('not a file');
      if (st.size > MAX_FILE_BYTES) { note += `\n\n[上下文文件 ${p} 过大（${st.size}B > 64KB），已省略]`; continue; }
      note += `\n\n[上下文文件 ${p}]\n` + readFile(p);
      used.push(p);
    } catch (e) {
      note += `\n\n[上下文文件 ${p} 不可读：${e.message}]`;
    }
  }
  return { text: (clean || text) + note, used };
}

module.exports = { augmentContext, MAX_FILE_BYTES };
