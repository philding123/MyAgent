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
  // best-effort: vendor the Electron-ABI SQLite so the smoke reports the real
  // store mode (missing vendor = JSON fallback, non-fatal by design)
  run('electron-sqlite', process.execPath, ['scripts/setup-electron-sqlite.mjs'], { log: false, timeout: 330000 });
  const out = path.join(ART, 'smoke-result.json');
  if (existsSync(out)) fs.rmSync(out);
  const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
  if (!existsSync(electronJs)) {
    results.e2e = { code: 2, error: 'electron not installed' };
  } else {
    // Linux CI/containers: no display → wrap in xvfb-run; root needs
    // --no-sandbox (Chromium refuses to start otherwise)
    // Linux: the sandbox helper check runs before app JS (where the app adds
    // --no-sandbox itself), so pass it on the command line — Ubuntu 24.04+
    // aborts otherwise (non-root too)
    const linuxArgs = process.platform === 'linux' ? ['--no-sandbox'] : [];
    const headless = process.platform === 'linux' && !process.env.DISPLAY;
    // explicit 24-bit screen: xvfb-run's default is 640×480×8
    const [cmd, args] = headless
      ? ['xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', process.execPath, electronJs, '.', ...linuxArgs]]
      : [process.execPath, [electronJs, '.', ...linuxArgs]];
    const smokeRun = run('e2e-smoke', cmd, args, {
      shell: true, log: false, timeout: 300000,
      env: { MYAGENT_SMOKE: '1', MYAGENT_SMOKE_OUT: out,
        MYAGENT_SMOKE_SHARE: path.join(ROOT, 'tests', 'fixtures', 'share-sample.txt') },
    });
    let parsed = null;
    for (let i = 0; i < 300 && !parsed; i++) {
      if (existsSync(out)) {
        try { parsed = JSON.parse(readFileSync(out, 'utf8')); if (!('exitCode' in parsed)) parsed = null; } catch (_) { parsed = null; }
      }
      if (!parsed) await sleep(1000);
    }
    if (parsed) {
      results.e2e = { code: parsed.exitCode, steps: parsed.steps, ok: parsed.ok };
    } else {
      results.e2e = { code: 1, error: 'no smoke result within 120s' };
      // show why: the app's own output (normally suppressed)
      console.log('[e2e-smoke] no result — app output tail:\n' + String(smokeRun.out || '').split('\n').slice(-60).join('\n'));
    }
    if (process.platform === 'win32') {
      spawnSync('powershell', ['-NoProfile', '-Command',
        "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*myagent*' } | Stop-Process -Force"],
        { timeout: 30000 });
    }
  }
}

// 3b) outcome-based button audit (T49): every clickable control in the main /
// settings / search windows driven for real and asserted by its effect
{
  const auditOut = path.join(ART, 'button-audit');
  const r = run('button-audit', process.execPath, ['scripts/button-audit.mjs', '--out', auditOut], { log: false, timeout: 900000 });
  let list = [];
  try { list = JSON.parse(readFileSync(path.join(auditOut, 'results.json'), 'utf8')); } catch (_) {}
  results.audit = { code: r.code, results: list };
  console.log(r.out.split('\n').filter((l) => /^(FAIL|button audit)/.test(l)).join('\n'));
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
  T19: ['mermaid-render'],
  T20: ['preview-readbinary', 'preview-window'],
  T21: ['updater-status'],
  T22: ['browser-tool'],
  T23: ['im-status'],
  T24: ['share-argv'],
  T25: ['market-status'],
  T26: ['sync-status'],
  T27: ['phase4-fields'],
  T28: ['a2a-card'],
  T29: ['ui-token', 'ui-shell', 'ui-main', 'ui-settings', 'ui-search', 'ui-preview', 'ui-token-dark', 'ui-paywall-zero'],
  T30: ['mcp-status'],
  T31: ['menu'],
  T32: ['splash-handoff'],
  T33: [],
  T34: [],
  T35: [],
  T36: [],
  T37: [],
  T38: [],
  T39: [],
  T40: [],
  T41: [],
  T42: [],
  T43: [],
  T44: ['ui-tool-surfaces'],
  T46: [],
  T47: [],
  T48: ['ui-nav', 'ui-hub'],
  T49: [],
  T53: ['conversation-window', 'conversation-main-shell', 'conversation-retarget', 'conversation-self'],
};

const featureNames = {
  T01: 'F01 多窗口', T02: 'F02 守护进程+RPC', T03: 'F03 存储', T04: 'F04 引擎', T05: 'F05 预热池',
  T06: 'F06 工具集', T07: 'F07 模式策略', T08: 'F08 沙箱', T09: 'F09 确认门控', T10: 'F10 凭证保护',
  T11: 'F11 技能系统', T12: 'F12 本地市场', T13: 'F13 记忆', T14: 'F14 终端', T15: 'F15 全局搜索',
  T16: 'F16 托盘/Deeplink', T17: 'F17 渲染管线', T18: 'F18 设置/自检',
  T19: 'F19 mermaid 渲染', T20: 'F20 文档预览', T21: 'F21 自动更新器', T22: 'F22 Browser-use',
  T23: 'F23 IM 通道', T24: 'F24 分享目标', T25: 'F25 云端市场', T26: 'F26 端云同步',
  T27: 'F27 云沙箱', T28: 'F28 A2A 协作', T29: 'F29-F33 像素级 UI（WorkBuddy 复刻，排除支付）',
  T30: 'F34 MCP 服务面', T31: 'F35 原生菜单最小面', T32: 'F36 启动画面 splash',
  T33: 'F39 空间', T34: 'F40 定时任务', T35: 'F41 预设（助理）', T36: 'F42 资料库', T37: 'F43 @ 上下文',
  T38: 'F46 web_search/web_fetch 检索', T39: 'F47 present_file 交付', T40: 'F45 任务步数预算与续跑',
  T41: 'F48/F49 计划卡与进度用量', T42: 'F50 上下文自动压缩', T43: 'F51 会话消息落库',
  T44: 'F44 产物卡片与运行反馈面（渲染层）',
  T46: 'F52 连接器（MCP 客户端）',
  T47: 'F53 内置 Claude 技能市场',
  T48: 'F54 wb 侧栏六项 + 专家·技能·连接器页',
  T49: '逐按钮结果审计（主窗/设置窗/搜索窗全部控件）',
  T50: 'F55 会话产物中心、历史恢复及安全文件操作',
  T51: 'F56 开源专家市场（agency-agents 精选 persona → 预设）',
  T52: 'F57 社交/社区内容拉取（social_fetch：HN + RSS/RSSHub）',
  T53: 'F37 会话独立窗口（单实例复用重定向 + conversation 模式 + win-self）',
  T54: 'F58 文件历史/回滚（本地版本快照 + files.history.* + 产物面板恢复）',
  T55: 'F59 Computer Use（引擎视觉回路 + 浏览器 CUA + OS computer 工具，默认关门控）',
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
const auditList = results.audit?.results || [];
lines.push('- 按钮审计: ' + (results.audit ? (results.audit.code === 0 && auditList.length ? 'PASS' : 'FAIL') : 'n/a')
  + ` (${auditList.filter((a) => a.pass).length}/${auditList.length}，明细 artifacts/button-audit/button-audit.md)`);
lines.push('');
lines.push('| T | 功能点 | 结果 | 明细 |');
lines.push('|---|---|---|---|');
for (const tid of Object.keys(featureNames)) {
  const subs = tid === 'T49'
    ? (auditList.length ? auditList.map((a) => ({ ok: a.pass, name: a.id })) : [{ ok: false, name: 'button audit produced no results' }])
    : (tIndex[tid] || []);
  const e2eNames = e2eMap[tid] || [];
  const e2eSteps = (results.e2e?.steps || []).filter((s) => e2eNames.includes(s.name));
  const allOk = subs.every((s) => s.ok) && e2eSteps.every((s) => s.ok)
    && (subs.length + e2eSteps.length > 0);
  // T49 has ~90 rows: summarise, list only the failures
  const detail = tid === 'T49'
    ? `${subs.filter((s) => s.ok).length}/${subs.length} 控件按效果断言通过` + subs.filter((s) => !s.ok).map((s) => '<br>✗ ' + s.name).join('')
    : [
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
// the gate aggregates the T rows, not just phase exit codes: a watchdog-
// truncated smoke still writes exitCode 0, and e2e-only rows (e.g. T16) have
// no unit tests to fail — only their missing steps would reveal it
let rowsOk = true;
for (const tid of Object.keys(featureNames)) {
  // audit rows carry .pass (not .ok) — map exactly like the report loop
  const subs = tid === 'T49'
    ? (auditList.length ? auditList.map((a) => ({ ok: a.pass, name: a.id })) : [{ ok: false, name: 'button audit produced no results' }])
    : (tIndex[tid] || []);
  const e2eNames = e2eMap[tid] || [];
  const e2eSteps = (results.e2e?.steps || []).filter((s) => e2eNames.includes(s.name));
  const ok = subs.every((s) => s.ok) && e2eSteps.every((s) => s.ok)
    && e2eSteps.length === e2eNames.length && (subs.length + e2eSteps.length > 0);
  if (!ok) { rowsOk = false; console.log('ROW FAIL: ' + tid); }
}
const allGreen = results.unit?.code === 0 && results.integration?.code === 0 && results.e2e?.code === 0
  && results.audit?.code === 0 && auditList.length > 0 && rowsOk;
console.log(allGreen ? '\nALL GREEN' : '\nHAS FAILURES');
process.exit(allGreen ? 0 : 1);
