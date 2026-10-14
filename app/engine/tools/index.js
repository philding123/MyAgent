'use strict';
// Built-in tools (F06). Every tool returns {ok, summary, data?}; errors are
// values, never throws. All paths go through the sandbox.

const fs = require('fs');
const path = require('path');

const MAX_READ_LINES = 2000;

function makeTools({ sandbox, skillRegistry }) {
  const tools = {
    read_file: {
      kind: 'read',
      description: 'Read a text file. Args: {path, offset?, limit?}',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } },
        required: ['path'],
      },
      run: async (args) => {
        const chk = sandbox.checkFile(args.path, 'read');
        if (!chk.ok) return { ok: false, summary: 'sandbox denied: ' + chk.path };
        const text = fs.readFileSync(chk.path, 'utf8');
        const lines = text.split(/\r?\n/);
        const offset = Math.max(0, (args.offset || 1) - 1);
        const slice = lines.slice(offset, offset + Math.min(args.limit || MAX_READ_LINES, MAX_READ_LINES));
        const numbered = slice.map((l, i) => String(offset + i + 1).padStart(5) + '\t' + l).join('\n');
        return { ok: true, summary: chk.path + ' (' + slice.length + ' lines)', data: { content: numbered } };
      },
    },
    list_dir: {
      kind: 'read',
      description: 'List a directory. Args: {path}',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      run: async (args) => {
        const chk = sandbox.checkFile(args.path, 'read');
        if (!chk.ok) return { ok: false, summary: 'sandbox denied: ' + chk.path };
        const entries = fs.readdirSync(chk.path, { withFileTypes: true }).map((e) => {
          let size = 0;
          if (e.isFile()) { try { size = fs.statSync(path.join(chk.path, e.name)).size; } catch (_) {} }
          return (e.isDirectory() ? '[d] ' : '[f] ') + e.name + (e.isFile() ? ' (' + size + 'B)' : '');
        });
        return { ok: true, summary: chk.path + ': ' + entries.length + ' entries', data: { entries } };
      },
    },
    write_file: {
      kind: 'write',
      description: 'Write a text file (creates parent dirs). Args: {path, content, create_dirs?}',
      schema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' }, create_dirs: { type: 'boolean' } },
        required: ['path', 'content'],
      },
      run: async (args) => {
        const chk = sandbox.checkFile(args.path, 'write');
        if (!chk.ok) return { ok: false, summary: 'sandbox denied: ' + chk.path };
        if (args.create_dirs !== false) fs.mkdirSync(path.dirname(chk.path), { recursive: true });
        fs.writeFileSync(chk.path, args.content, 'utf8');
        return { ok: true, summary: 'wrote ' + chk.path + ' (' + Buffer.byteLength(args.content) + 'B)' };
      },
    },
    run_command: {
      kind: 'exec',
      description: 'Run a shell command in the session workspace. Args: {command, timeout_ms?}',
      schema: {
        type: 'object',
        properties: { command: { type: 'string' }, timeout_ms: { type: 'number' } },
        required: ['command'],
      },
      run: async (args) => {
        const { execFile } = require('child_process');
        const isWin = process.platform === 'win32';
        const bin = isWin ? 'cmd.exe' : '/bin/sh';
        const binArgs = isWin ? ['/d', '/s', '/c', args.command] : ['-c', args.command];
        return new Promise((resolve) => {
          execFile(bin, binArgs, { cwd: sandbox.workspace, timeout: Math.min(args.timeout_ms || 60000, 300000),
            maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
            if (err && err.killed) return resolve({ ok: false, summary: 'timeout after ' + (args.timeout_ms || 60000) + 'ms' });
            const code = err ? err.code : 0;
            const summary = 'exit ' + code + (stdout ? '; stdout ' + stdout.length + 'B' : '') + (stderr ? '; stderr ' + stderr.length + 'B' : '');
            resolve({ ok: code === 0, summary,
              data: { code, stdout: String(stdout || '').slice(0, 20000), stderr: String(stderr || '').slice(0, 8000) } });
          });
        });
      },
    },
    search: {
      kind: 'read',
      description: 'Search workspace files by substring. Args: {query, glob?}',
      schema: {
        type: 'object',
        properties: { query: { type: 'string' }, glob: { type: 'string' } },
        required: ['query'],
      },
      run: async (args) => {
        const hits = [];
        const walk = (dir, depth) => {
          if (hits.length >= 30 || depth > 6) return;
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
          for (const e of entries) {
            if (hits.length >= 30) return;
            if (e.name === 'node_modules' || e.name === '.git') continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full, depth + 1); continue; }
            if (args.glob && !e.name.toLowerCase().endsWith(String(args.glob).replace(/^\*/, '').toLowerCase())) continue;
            let text;
            try { text = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
            text.split(/\r?\n/).forEach((line, i) => {
              if (hits.length < 30 && line.toLowerCase().includes(args.query.toLowerCase())) {
                hits.push({ path: full, line: i + 1, text: line.slice(0, 160) });
              }
            });
          }
        };
        walk(sandbox.workspace, 0);
        return { ok: true, summary: hits.length + ' hits for "' + args.query + '"', data: { hits } };
      },
    },
    skill_read: {
      kind: 'read',
      description: 'Read a loaded skill full text. Args: {name}',
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      run: async (args) => {
        const s = skillRegistry && skillRegistry.read(args.name);
        if (!s) return { ok: false, summary: 'skill not found: ' + args.name };
        return { ok: true, summary: 'skill ' + s.name + ' (' + s.body.length + ' chars)', data: { skill: s } };
      },
    },
  };

  const definitions = Object.entries(tools).map(([name, t]) => ({
    type: 'function',
    function: { name, description: t.description, parameters: t.schema },
  }));

  return { tools, definitions };
}

module.exports = { makeTools };
