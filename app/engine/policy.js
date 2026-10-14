'use strict';
// Interaction mode policy (F07). Mirrors WorkBuddy's interactionmode fragments:
// ask = "Talk only, hands off" (no writes, no shell); plan = read + read-only
// commands, writes need approval; craft = everything subject to sandbox/confirm.
// Enforcement lives HERE (engine side), not only in the prompt.

const READONLY_CMD = [/^\s*(ls|dir|type|cat|head|tail|echo|pwd|whoami|git (status|log|diff|branch)|node -v|npm ls|python -V|where|which)\b/i];

const MODE_RULES = {
  ask: { write: 'deny', exec: 'deny' },
  plan: { write: 'confirm', exec: 'readonly-allowlist' },
  craft: { write: 'allow', exec: 'allow' },
};

/** @returns {verdict:'allow'|'deny'|'confirm', reason} */
function checkToolMode(mode, toolKind, toolName, args) {
  const rules = MODE_RULES[mode] || MODE_RULES.craft;
  if (toolKind === 'write') {
    if (rules.write === 'deny') return { verdict: 'deny', reason: 'policy:' + mode + ' mode is read-only' };
    if (rules.write === 'confirm') return { verdict: 'confirm', reason: 'policy:plan mode requires approval for writes' };
    return { verdict: 'allow' };
  }
  if (toolKind === 'exec') {
    if (rules.exec === 'deny') return { verdict: 'deny', reason: 'policy:' + mode + ' mode forbids shell commands' };
    if (rules.exec === 'readonly-allowlist') {
      const cmd = (args && args.command) || '';
      if (READONLY_CMD.some((re) => re.test(cmd))) return { verdict: 'allow' };
      return { verdict: 'confirm', reason: 'policy:plan mode allows only read-only commands' };
    }
    return { verdict: 'allow' };
  }
  return { verdict: 'allow' };
}

function systemPromptFragment(mode) {
  const fragments = {
    ask: `<current_mode>
You are currently running in Ask mode (Talk only, hands off).

Hard rules:
- Only answer questions, read files, and analyze information.
- You may use read-only tools to inspect files or fetch reference material.
- You must NOT modify files or run shell commands.
- If the user's primary request is to create, modify, delete files, or run commands, do not call tools; explain that Ask mode is read-only and suggest switching to Agent mode.
</current_mode>`,
    plan: `<current_mode>
You are currently running in Plan mode (read + propose).

Rules:
- You may read files, list directories, and run read-only commands (ls/dir/cat/git status ...).
- File modifications and state-changing commands require user approval; propose a plan first.
</current_mode>`,
    craft: `<current_mode>
You are currently running in Craft mode (full agent).

You can read, write files, and run commands. Dangerous commands will ask for user confirmation. Proceed efficiently and verify your work.
</current_mode>`,
  };
  return fragments[mode] || fragments.craft;
}

module.exports = { checkToolMode, systemPromptFragment, MODE_RULES };
