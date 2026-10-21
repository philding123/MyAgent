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

// F43 「/技能名 …」: a leading slash command naming an enabled skill invokes
// it — the SKILL.md body is attached so the engine follows it this turn.
const SKILL_RE = /^\/([A-Za-z0-9][\w.-]*)(?=\s|$)/;
const MAX_SKILL_CHARS = 48 * 1024;

function augmentSkill(text, findSkill) {
  const m = SKILL_RE.exec(String(text || '').trimStart());
  const s = m && findSkill(m[1]);
  if (!s) return { text, skill: null };
  const body = String(s.body || '').slice(0, MAX_SKILL_CHARS);
  return {
    text: `${text}\n\n[用户通过 / 调用了技能「${s.name}」，本轮按以下技能说明执行（技能目录 ${s.dir}，其中的脚本/参考文件可用 read_file 读取）]\n<skill name="${s.name}">\n${body}\n</skill>`,
    skill: s.name,
  };
}

module.exports = { augmentContext, augmentSkill, MAX_FILE_BYTES };
