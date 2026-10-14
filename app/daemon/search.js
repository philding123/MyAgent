'use strict';
// Global search (F15): sessions DB + workspace files, mirrors WorkBuddy's
// global-search extension ("跨任务/空间/项目/产物检索并跳转定位").

const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.venv', '__pycache__', 'runtime-data']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.exe', '.dll', '.node', '.zip',
  '.asar', '.pdb', '.pak', '.bin', '.woff', '.woff2', '.ttf', '.pdf', '.db', '.sqlite']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 2000;

function searchWorkspace(root, query, out, depth) {
  if (out.length >= 50 || depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (out.length >= 50) return;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) searchWorkspace(full, query, out, depth + 1);
      continue;
    }
    if (BINARY_EXT.has(path.extname(e.name).toLowerCase())) continue;
    let stat;
    try { stat = fs.statSync(full); } catch (_) { continue; }
    if (stat.size > MAX_FILE_BYTES) continue;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
    const lines = text.split(/\r?\n/);
    const needle = query.toLowerCase();
    lines.forEach((line, i) => {
      if (out.length < 50 && line.toLowerCase().includes(needle)) {
        out.push({ type: 'file', path: full, line: i + 1, text: line.slice(0, 200) });
      }
    });
  }
}

/**
 * @returns [{type:'message', session_id, role, content, created_at} |
 *           {type:'file', path, line, text}]
 */
function globalSearch(store, query, workspace) {
  const results = [];
  for (const m of store.searchMessages(query)) {
    results.push({ type: 'message', session_id: m.session_id, role: m.role,
      content: (m.content || '').slice(0, 200), created_at: m.created_at });
    if (results.length >= 50) return results;
  }
  if (workspace && fs.existsSync(workspace)) searchWorkspace(workspace, query, results, 0);
  return results;
}

module.exports = { globalSearch };
