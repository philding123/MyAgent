'use strict';
// Built-in tools (F06). Every tool returns {ok, summary, data?}; errors are
// values, never throws. All paths go through the sandbox — unless the F27
// cloud backend is enabled, in which case file/command ops execute inside the
// remote sandbox (isolation delegated; policy kinds unchanged).

const fs = require('fs');
const path = require('path');
const { makeWebTools } = require('./web');
const { makePresentTool } = require('./present');

const MAX_READ_LINES = 2000;

function makeTools({ sandbox, skillRegistry, browser, cloud, daemonBridge, library, webFetchImpl, getPresentDestDir }) {
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
        if (cloud) {
          try {
            const r = await cloud.read(args.path);
            const text = String((r && r.content) ?? '');
            const lines = text.split(/\r?\n/);
            const offset = Math.max(0, (args.offset || 1) - 1);
            const slice = lines.slice(offset, offset + Math.min(args.limit || MAX_READ_LINES, MAX_READ_LINES));
            const numbered = slice.map((l, i) => String(offset + i + 1).padStart(5) + '\t' + l).join('\n');
            return { ok: true, summary: 'cloud:' + args.path + ' (' + slice.length + ' lines)', data: { content: numbered } };
          } catch (e) { return { ok: false, summary: 'cloud read failed: ' + (e.message || e) }; }
        }
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
        if (cloud) {
          try {
            const r = await cloud.list(args.path);
            const entries = (r && r.entries || []).map((e) =>
              (e.type === 'dir' ? '[d] ' : '[f] ') + e.path.split('/').pop() + (e.type === 'file' ? ' (' + (e.size || 0) + 'B)' : ''));
            return { ok: true, summary: 'cloud:' + args.path + ': ' + entries.length + ' entries', data: { entries } };
          } catch (e) { return { ok: false, summary: 'cloud list failed: ' + (e.message || e) }; }
        }
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
        if (cloud) {
          try {
            await cloud.write(args.path, args.content);
            return { ok: true, summary: 'cloud:wrote ' + args.path + ' (' + Buffer.byteLength(args.content) + 'B)',
              data: { path: args.path, location: 'remote' } };
          } catch (e) { return { ok: false, summary: 'cloud write failed: ' + (e.message || e) }; }
        }
        const chk = sandbox.checkFile(args.path, 'write');
        if (!chk.ok) return { ok: false, summary: 'sandbox denied: ' + chk.path };
        if (args.create_dirs !== false) fs.mkdirSync(path.dirname(chk.path), { recursive: true });
        fs.writeFileSync(chk.path, args.content, 'utf8');
        return { ok: true, summary: 'wrote ' + chk.path + ' (' + Buffer.byteLength(args.content) + 'B)',
          data: { path: chk.path, location: 'local' } };
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
        if (cloud) {
          try {
            const r = await cloud.execCommand(args.command, { timeoutMs: Math.min(args.timeout_ms || 60000, 300000) });
            return { ok: r.code === 0, summary: 'cloud exit ' + r.code,
              data: { code: r.code, stdout: r.stdout.slice(0, 20000), stderr: r.stderr.slice(0, 8000) } };
          } catch (e) { return { ok: false, summary: 'cloud exec failed: ' + (e.message || e) }; }
        }
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

  // F22 browser tool: registered only when playwright-core + a system browser
  // exist; absent tool = capability off (selfcheck reports it).
  if (browser) tools.browser = browser;

  // F46 web retrieval (task-parity P0-2): search + fetch without a browser
  // launch (wb collects server-side; see web.js header for the benchmark).
  Object.assign(tools, makeWebTools({ fetchImpl: webFetchImpl }));

  // F47 present_file (task-parity P0-3): user-visible delivery, wb
  // present_files semantics (engine forwards dest as tool_result.artifact).
  tools.present_file = makePresentTool({ sandbox, getDestDir: getPresentDestDir, cloud });

  // F25 market tool: capabilities live in the daemon; bridge request/response.
  if (daemonBridge) {
    tools.market = {
      kind: 'read',
      kindOf: (args) => (args.action === 'install' ? 'write' : 'read'),
      description: 'Search and install skills from configured marketplaces. Args: {action: search|install, keywords?: string[], names?: string[]}',
      schema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['search', 'install'] }, keywords: { type: 'array', items: { type: 'string' } }, names: { type: 'array', items: { type: 'string' } } },
        required: ['action'],
      },
      run: async (args) => daemonBridge(args),
    };
  }

  // F28 agent delegation (A2A client): direct HTTP from the engine, read-kind.
  tools.agent_delegate = {
    kind: 'read',
    description: 'Delegate a task to a remote A2A agent. Args: {url, message}',
    schema: {
      type: 'object',
      properties: { url: { type: 'string' }, message: { type: 'string' } },
      required: ['url', 'message'],
    },
    run: async (args) => {
      try {
        const { delegate } = require('../daemon/a2a');
        const r = await delegate(args.url, args.message, { timeoutMs: 120000 });
        return { ok: true, summary: 'agent ' + (r.card && r.card.name || args.url) + ' replied (' + (r.text || '').length + ' chars)',
          data: { text: r.text, agent: { name: r.card && r.card.name, url: r.card && r.card.url } } };
      } catch (e) {
        return { ok: false, summary: 'delegate failed: ' + (e.message || e) };
      }
    },
  };

  // F42 library (design/34): the daemon-owned 资料库 directory is a trusted
  // read-only domain of its own — basename-guarded, outside the workspace
  // sandbox by design.
  if (library && library.dir) {
    tools.library_list = {
      kind: 'read',
      description: 'List files in the MyAgent library (资料库). Args: {}',
      schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const entries = fs.readdirSync(library.dir, { withFileTypes: true })
          .filter((d) => d.isFile())
          .map((d) => { const st = fs.statSync(path.join(library.dir, d.name)); return d.name + ' (' + st.size + 'B)'; });
        return { ok: true, summary: 'library: ' + entries.length + ' files', data: { entries } };
      },
    };
    tools.library_read = {
      kind: 'read',
      description: 'Read a file from the MyAgent library (资料库). Args: {name}',
      schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      run: async (args) => {
        const p = path.join(library.dir, path.basename(args.name));
        if (!fs.existsSync(p)) return { ok: false, summary: 'not in library: ' + args.name };
        const text = fs.readFileSync(p, 'utf8');
        return { ok: true, summary: p + ' (' + text.length + ' chars)', data: { content: text } };
      },
    };
  }

  const definitions = Object.entries(tools).map(([name, t]) => ({
    type: 'function',
    function: { name, description: t.description, parameters: t.schema },
  }));

  return { tools, definitions };
}

module.exports = { makeTools };
