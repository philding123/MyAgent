#!/usr/bin/env node
// Acceptance runner (design 99-test-plan.md): build → unit → integration →
// e2e smoke → acceptance report with per-T mapping.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } = fs;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ART = path.join(ROOT, 'artifacts');
mkdirSync(ART, { recursive: true });

const results = { unit: null, integration: null, e2e: null, startedAt: new Date().toISOString() };

function run(name, cmd, args, opts = {}) {
  console.log(`\n=== [${name}] ${cmd} ${args.join(' ')} ===`);
  let r;
  if (opts.shell) {
    // GUI-subsystem executables (electron.exe) don't propagate exit codes to
    // spawnSync on Windows; route through cmd so $? is meaningful.
    const line = [cmd, ...args].map((a) => (/\s/.test(a) ? '"' + a + '"' : a)).join(' ');
    r = spawnSync(line, { cwd: ROOT, encoding: 'utf8', shell: true,
      env: { ...process.env, ...(opts.env || {}) }, timeout: opts.timeout || 300000 });
  } else {
    r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: false,
      env: { ...process.env, ...(opts.env || {}) }, timeout: opts.timeout || 300000 });
  }
  const out = (r.stdout || '') + (r.stderr || '');
  if (opts.log !== false) console.log(out.slice(-4000));
  if (r.status === null) console.log(`[${name}] signal:`, r.signal, r.error || '');
  return { code: r.status, out };
}

function parseTap(tap) {
  // returns [{name, ok}] from TAP output of node --test
  const tests = [];
  for (const line of tap.split('\n')) {
    const m = /^(not )?ok \d+ - (.+)$/.exec(line.trim());
    if (m) tests.push({ ok: !m[1], name: m[2] });
    const f = /^# fail (\d+)/.exec(line.trim());
    if (f) tests.fail = +f[1];
    const p = /^# pass (\d+)/.exec(line.trim());
    if (p) tests.pass = +p[1];
  }
  return tests;
}

// 1) build renderer bundles
const build = run('build', 'node', ['scripts/build.mjs']);
if (build.code !== 0) { console.error('BUILD FAILED'); process.exit(2); }

// 2) unit + integration with TAP capture (node test-runner globs the patterns itself)
let unitTests = [], intTests = [];
{
  const r = run('unit', process.execPath, ['--test', '--test-reporter', 'tap', 'tests/unit/*.test.js'], { log: true });
  results.unit = { code: r.code, tests: parseTap(r.out) };
  unitTests = results.unit.tests;
}
{
  const r = run('integration', process.execPath, ['--test', '--test-reporter', 'tap', 'tests/integration/*.test.js'], { log: true, timeout: 420000 });
  results.integration = { code: r.code, tests: parseTap(r.out) };
  intTests = results.integration.tests;
}

// 3) e2e electron smoke — the Electron process tree can outlive process.exit()
// on Windows, so poll the result JSON and force-kill leftovers afterwards.
{
  const out = path.join(ART, 'smoke-result.json');
  if (existsSync(out)) fs.rmSync(out);
  const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
  if (!existsSync(electronJs)) {
    results.e2e = { code: 2, error: 'electron not installed' };
  } else {
    run('e2e-smoke', process.execPath, [electronJs, '.'], {
      shell: true, log: false, env: { MYAGENT_SMOKE: '1', MYAGENT_SMOKE_OUT: out }, timeout: 150000 });
    let parsed = null;
    for (let i = 0; i < 120 && !parsed; i++) {
      if (existsSync(out)) {
        try { parsed = JSON.parse(readFileSync(out, 'utf8')); if (!('exitCode' in parsed)) parsed = null; } catch (_) { parsed = null; }
      }
      if (!parsed) await sleep(1000);
    }
    if (parsed) {
      results.e2e = { code: parsed.exitCode, steps: parsed.steps, ok: parsed.ok };
    } else {
      results.e2e = { code: 1, error: 'no smoke result within 120s' };
    }
    spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*myagent*' } | Stop-Process -Force"],
      { timeout: 30000 });
  }
}

// 4) acceptance report
const tIndex = {};
for (const t of [...unitTests, ...intTests]) {
  const m = /^(T\d+)[a-z]?\b/.exec(t.name);
  if (!m) continue;
  (tIndex[m[1]] ||= []).push(t);
}
const e2eMap = {
  T01: ['main-window', 'main-loaded', 'multi-window'],
  T16: ['deeplink-consumed', 'tray'],
  T17: ['render-sanitize'],
  T18: ['selfcheck', 'preload-bridge'],
};

const featureNames = {
  T01: 'F01 多窗口', T02: 'F02 守护进程+RPC', T03: 'F03 存储', T04: 'F04 引擎', T05: 'F05 预热池',
  T06: 'F06 工具集', T07: 'F07 模式策略', T08: 'F08 沙箱', T09: 'F09 确认门控', T10: 'F10 凭证保护',
  T11: 'F11 技能系统', T12: 'F12 本地市场', T13: 'F13 记忆', T14: 'F14 终端', T15: 'F15 全局搜索',
  T16: 'F16 托盘/Deeplink', T17: 'F17 渲染管线', T18: 'F18 设置/自检',
};

let lines = [];
lines.push('# MyAgent 验收报告');
lines.push('');
lines.push('- 生成时间: ' + new Date().toISOString());
lines.push('- 单元测试: ' + (results.unit ? (results.unit.code === 0 ? 'PASS' : 'FAIL') : 'n/a')
  + ` (${(results.unit?.tests || []).length} cases)`);
lines.push('- 集成测试: ' + (results.integration ? (results.integration.code === 0 ? 'PASS' : 'FAIL') : 'n/a')
  + ` (${(results.integration?.tests || []).length} cases)`);
lines.push('- E2E 冒烟: ' + (results.e2e ? (results.e2e.code === 0 ? 'PASS' : 'FAIL') : 'n/a'));
lines.push('');
lines.push('| T | 功能点 | 结果 | 明细 |');
lines.push('|---|---|---|---|');
for (let i = 1; i <= 18; i++) {
  const tid = 'T' + String(i).padStart(2, '0');
  const subs = tIndex[tid] || [];
  const e2eNames = e2eMap[tid] || [];
  const e2eSteps = (results.e2e?.steps || []).filter((s) => e2eNames.includes(s.name));
  const allOk = subs.every((s) => s.ok) && e2eSteps.every((s) => s.ok)
    && (subs.length + e2eSteps.length > 0);
  const detail = [
    ...subs.map((s) => (s.ok ? '✓' : '✗') + ' ' + s.name),
    ...e2eSteps.map((s) => (s.ok ? '✓' : '✗') + ' e2e:' + s.name + (s.detail ? ' (' + s.detail + ')' : '')),
  ].join('<br>');
  lines.push(`| ${tid} | ${featureNames[tid] || ''} | ${allOk ? 'PASS' : 'FAIL'} | ${detail} |`);
}
lines.push('');
lines.push('## 降级记录');
const e2eSelf = (results.e2e?.steps || []).find((s) => s.name === 'selfcheck');
if (e2eSelf) lines.push('- Electron 运行时 store 模式: ' + e2eSelf.detail);
const intSelf = intTests.find((t) => /selfcheck/.test(t.name));
if (results.integration?.code !== 0) lines.push('- 集成测试存在失败，见上方明细');

const report = lines.join('\n');
writeFileSync(path.join(ART, 'acceptance-report.md'), report);
writeFileSync(path.join(ART, 'verify-raw.json'), JSON.stringify(results, null, 2));
console.log('\n' + report);
const allGreen = results.unit?.code === 0 && results.integration?.code === 0 && results.e2e?.code === 0;
console.log(allGreen ? '\nALL GREEN' : '\nHAS FAILURES');
process.exit(allGreen ? 0 : 1);
