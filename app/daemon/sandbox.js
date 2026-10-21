'use strict';
// File sandbox rule engine (F08). Rule file format mirrors WorkBuddy's
// cli/vendor/sandbox/5.7.10/tsbx_rules.json: env-var expansion + ** glob,
// first matching rule wins, "read=deny|write=deny|delete=deny" actions.

const os = require('os');
const path = require('path');

function expandEnv(p, extraEnv) {
  const env = Object.assign({}, process.env, extraEnv || {});
  return String(p)
    .replace(/%([^%]+)%/g, (m, name) => {
      if (name.toUpperCase() === 'USERPROFILE') return os.homedir();
      // wb rule files are written for Windows; %TEMP%/%TMP% = the OS temp dir
      // everywhere (on posix these vars are usually unset)
      if (/^(TEMP|TMP)$/i.test(name) && env[name] === undefined) return os.tmpdir();
      if (name.toUpperCase() === 'WORKSPACE') return (extraEnv && extraEnv.WORKSPACE) || '';
      return env[name] !== undefined ? env[name] : m;
    })
    .replace(/^~/, os.homedir());
}

// Separators are OS-agnostic: `/` and `\` in a rule both match either, so a
// wb-format rule (`%USERPROFILE%\.ssh\**`) protects ~/.ssh on posix too.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '[\\s\\S]*'; i++; if (glob[i + 1] === '/' || glob[i + 1] === '\\') i++; }
      else re += '[^/\\\\]*';
    } else if (c === '?') re += '[^/\\\\]';
    else if (c === '/' || c === '\\') re += '[/\\\\]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

function parseActions(actionStr) {
  // "read=deny|write=deny|delete=deny" -> {read:'deny',write:'deny',delete:'deny'}
  const out = {};
  for (const part of String(actionStr || '').split('|')) {
    const [op, verdict] = part.split('=');
    if (op && verdict) out[op.trim().toLowerCase()] = verdict.trim().toLowerCase();
  }
  return out;
}

class Sandbox {
  /**
   * @param rules {file_rules:[{path,action}], command_rules?:{deny_patterns,confirm_patterns}}
   * @param opts {workspace: string}
   */
  constructor(rules, opts) {
    this.workspace = path.resolve((opts && opts.workspace) || process.cwd());
    this.extraEnv = Object.assign({}, opts && opts.env, { WORKSPACE: this.workspace });
    this.fileRules = ((rules && rules.file_rules) || []).map((r) => ({
      re: globToRegExp(expandEnv(r.path, this.extraEnv)),
      actions: parseActions(r.action),
    }));
    const cr = (rules && rules.command_rules) || {};
    this.commandDeny = (cr.deny_patterns || []).map((p) => new RegExp(p, 'i'));
    this.commandConfirm = (cr.confirm_patterns || []).map((p) => new RegExp(p, 'i'));
  }

  checkFile(absPath, op) {
    // op: 'read' | 'write' | 'delete'
    const p = path.resolve(String(absPath));
    for (const rule of this.fileRules) {
      if (rule.re.test(p)) {
        const verdict = rule.actions[op];
        if (verdict === 'deny') return { ok: false, reason: 'sandbox', rule: rule.re.source, op, path: p };
        if (verdict === 'allow') return { ok: true, path: p };
      }
    }
    // Default fail-safe: inside workspace allow; outside allow read only.
    const inWorkspace = p === this.workspace || p.startsWith(this.workspace + path.sep);
    if (op === 'read') return { ok: true, path: p, defaultRule: true };
    return inWorkspace
      ? { ok: true, path: p, defaultRule: true }
      : { ok: false, reason: 'sandbox', op, path: p, defaultRule: true };
  }

  /** @returns {verdict:'allow'|'deny'|'confirm', reason?} */
  checkCommand(command) {
    const cmd = String(command || '');
    for (const re of this.commandDeny) if (re.test(cmd)) return { verdict: 'deny', reason: 'command_rules.deny' };
    for (const re of this.commandConfirm) if (re.test(cmd)) return { verdict: 'confirm' };
    return { verdict: 'allow' };
  }
}

function defaultRules(workspace) {
  const home = os.homedir();
  // must mirror daemon homeDir(): MYAGENT_HOME > APPDATA > ~/.config
  const appHome = process.env.MYAGENT_HOME
    || (process.env.APPDATA ? path.join(process.env.APPDATA, 'myagent') : path.join(home, '.config', 'myagent'));
  return {
    version: 1,
    file_rules: [
      { path: home + path.sep + '.ssh' + path.sep + '**', action: 'read=deny|write=deny|delete=deny', _comment: 'protect credentials' },
      { path: home + path.sep + '.gnupg' + path.sep + '**', action: 'read=deny|write=deny|delete=deny', _comment: 'protect credentials' },
      { path: home + path.sep + '.aws' + path.sep + '**', action: 'read=deny|write=deny|delete=deny', _comment: 'protect credentials' },
      { path: home + path.sep + '.config' + path.sep + 'myagent' + path.sep + '**', action: 'read=deny|write=deny|delete=deny', _comment: 'app credentials store' },
      { path: appHome + path.sep + '**', action: 'read=deny|write=deny|delete=deny', _comment: 'app credentials store (appdata)' },
      { path: path.join(workspace, '**'), action: 'read=allow|write=allow|delete=allow', _comment: 'workspace' },
      { path: os.tmpdir() + path.sep + '**', action: 'read=allow|write=allow|delete=allow', _comment: 'temp' },
    ],
    command_rules: {
      deny_patterns: ['\\brm\\s+-rf\\b', '\\brmdir\\s+/s\\b', '\\bdel\\s+/[fqs]', '\\bformat\\s+[a-z]:', '\\bshutdown\\b', '\\breg\\s+add\\b', '\\bschtasks\\s+/create\\b', '\\bcurl\\b[^|]*\\|\\s*(ba)?sh', '\\bInvoke-Expression\\b'],
      confirm_patterns: ['\\bgit\\s+push\\b', '\\bnpm\\s+publish\\b', '\\bmv\\s+.*\\s+/dev/', '>>?\\s*/etc/'],
    },
  };
}

module.exports = { Sandbox, defaultRules, globToRegExp, expandEnv, parseActions };
