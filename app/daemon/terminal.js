'use strict';
// Terminal host (F14): prefer @lydell/node-pty (ConPTY), degrade to a plain
// child_process pipe. kind is reported so UI/tests can assert the mode.

class TerminalHost {
  constructor(emit) {
    this.emit = emit;
    this.terminals = new Map();
    this.seq = 0;
    this.kind = 'pipe';
    try {
      // eslint-disable-next-line global-require
      const pty = require('@lydell/node-pty');
      this.pty = pty;
      this.kind = 'pty';
    } catch (_) { this.pty = null; }
  }

  create(opts) {
    const id = 'term_' + (++this.seq);
    const cwd = (opts && opts.cwd) || process.cwd();
    const isWin = process.platform === 'win32';
    const shell = (opts && opts.shell)
      || (isWin ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/bash');
    let proc;
    let kind = this.kind;
    if (this.pty) {
      proc = this.pty.spawn(shell, [], { name: 'xterm-256color', cwd, env: process.env });
    } else {
      kind = 'pipe';
      const { spawn } = require('child_process');
      proc = spawn(shell, isWin ? [] : ['-i'], { cwd, env: process.env, windowsHide: true });
    }
    const onData = (data) => this.emit('terminal:' + id + ':data', { data: data.toString('utf8') });
    proc.onData ? proc.onData(onData) : proc.stdout.on('data', onData);
    const onExit = () => { this.terminals.delete(id); this.emit('terminal:' + id + ':exit', {}); };
    proc.onExit ? proc.onExit(onExit) : proc.on('exit', onExit);
    if (!this.pty && proc.stderr) proc.stderr.on('data', onData);
    this.terminals.set(id, { proc, kind });
    return { id, kind, shell };
  }

  write(id, data) {
    const t = this.terminals.get(id);
    if (!t) return false;
    // pipe fallback: xterm sends \r for Enter, a non-tty shell wants \n
    t.proc.write ? t.proc.write(data) : t.proc.stdin.write(t.kind === 'pipe' ? String(data).replace(/\r/g, '\n') : data);
    return true;
  }

  resize(id, cols, rows) {
    const t = this.terminals.get(id);
    if (t && this.kind === 'pty' && t.proc.resize) { try { t.proc.resize(cols, rows); } catch (_) {} }
    return true;
  }

  kill(id) {
    const t = this.terminals.get(id);
    if (!t) return false;
    try { t.proc.kill ? t.proc.kill() : t.proc.destroy(); } catch (_) {}
    this.terminals.delete(id);
    return true;
  }

  killAll() { for (const id of [...this.terminals.keys()]) this.kill(id); }
  status() { return { kind: this.kind, count: this.terminals.size }; }
}

module.exports = { TerminalHost };
