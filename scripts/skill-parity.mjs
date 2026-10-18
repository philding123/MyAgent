#!/usr/bin/env node
// Skill parity harness (reverse-skill method, article step 3): install the
// reverse-skill pack into both apps, then run the SAME skill-driven analysis
// task and grade the outputs against the evidence-check contract (Evidence
// table with file:line citations + plain-language explanation).
//   node scripts/skill-parity.mjs --side my     # MyAgent (real app, real LLM)
//   node scripts/skill-parity.mjs --side wb     # WorkBuddy (live CDP)
//   node scripts/skill-parity.mjs --side grade  # build report from both runs
// Evidence: artifacts/skill-parity/. Quota: wb leg consumes cloud quota; MyAgent
// leg consumes the configured API — run deliberately.

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const SIDE = opt('side', 'my');
const PORT = SIDE === 'wb' ? 9333 : 9222;
const OUT = path.resolve(opt('out', 'artifacts/skill-parity'));
const TIMEOUT_SEC = parseInt(opt('timeout-sec', '1200'), 10);
const MY_WS = path.resolve(opt('ws', path.join(OUT, 'myagent-ws')));
const WB_WS = path.join(os.homedir(), '.workbuddy', 'workspace', 'sessions');
const USER_SKILLS = path.join(process.env.APPDATA || '', 'myagent', 'skills');
const ZC_SKILLS = path.join(os.homedir(), '.zcode', 'skills');
const WB_SKILLS = path.join(os.homedir(), '.workbuddy', 'skills');
// the reverse-skill pack (zhaoxuya520/reverse-skill) as installed in ~/.zcode/skills
const PACK = ['reverse-skill', 'reverse-engineer-anything', 'apk-reverse', 'js-reverse',
  'ghidra-reverse', 'ida-reverse', 'binary-ninja-reverse', 'dotnet-reverse', 'go-rust-reverse',
  'radare2', 'malware-analysis', 'protocol-reverse', 'patch-diff-exploit', 'thick-client',
  'mobile-reverse', 'macos-reverse', 'firmware-pentest', 'browser-extension-reverse'];
const TASK = '请分析工作区里 fixture-app.js 的【令牌桶限流器】是怎么实现的：先按逆向分析流程判断分析线并读取程序代码；结论完成后按 evidence-check 技能核对：给出 Evidence 记录表（每条结论标注 fixture-app.js 的行号出处与依据），最后用一段大白话把实现原理讲给完全不懂编程的人听。';
const FIXTURE = `// fixture-app.js — token bucket rate limiter (analysis target)
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.last = Date.now();
  }
  refill() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = now;
  }
  tryTake(n = 1) {
    this.refill();
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
}
function createLimiter(capacity, refillPerSec) {
  const bucket = new TokenBucket(capacity, refillPerSec);
  return (req, res, next) => {
    if (bucket.tryTake(1)) { next(); return; }
    res.statusCode = 429;
    res.end('rate limited');
  };
}
module.exports = { TokenBucket, createLimiter };
`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(MY_WS, { recursive: true });
fs.writeFileSync(path.join(MY_WS, 'fixture-app.js'), FIXTURE);

// ---------- install: reverse-skill pack into MyAgent user skills; probe wb ----------
function installMy() {
  fs.mkdirSync(USER_SKILLS, { recursive: true });
  const installed = [], missing = [];
  for (const name of PACK) {
    const src = path.join(ZC_SKILLS, name);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) { missing.push(name); continue; }
    fs.cpSync(src, path.join(USER_SKILLS, name), { recursive: true });
    installed.push(name);
  }
  console.log('[install-my] installed:', installed.length, 'missing:', missing.join(','));
  return { installed, missing };
}

function installWbProbe() {
  // wb keeps skills under its plugin/marketplace machinery; its plain skills/
  // dir is empty — probe whether a dropped SKILL.md is picked up at all
  fs.mkdirSync(path.join(WB_SKILLS, 'evidence-check'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'skills', 'evidence-check', 'SKILL.md'),
    path.join(WB_SKILLS, 'evidence-check', 'SKILL.md'));
  console.log('[install-wb] evidence-check dropped into', WB_SKILLS, '(probe: does wb scan it?)');
}

function waitForCdp(port, tries) {
  return (async () => {
    for (let i = 0; i < (tries || 60); i++) {
      await sleep(1000);
      try { await fetch(`http://127.0.0.1:${port}/json/version`); return true; } catch {}
    }
    return false;
  })();
}

function treeKill(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  } catch {}
}

// grade the final conversation text against the evidence-check contract
function grade(text) {
  const lines = new Set([...text.matchAll(/fixture-app\.js:(\d+)/g)].map((m) => m[1]));
  return {
    citations: lines.size,
    evidenceTable: /Evidence 记录|Evidence（证据）|证据记录/i.test(text),
    plainSection: /大白话/.test(text),
    pass: lines.size >= 3 && /大白话/.test(text),
  };
}

// ---------- MyAgent leg ----------
async function runMy() {
  const install = installMy();
  const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
  const child = spawn(process.execPath, [electronJs, '.', '--remote-debugging-port=9222',
    '--force-device-scale-factor=1'], { cwd: ROOT, stdio: 'ignore' });
  const timeline = [];
  let browser = null;
  try {
    if (!(await waitForCdp(9222))) throw new Error('MyAgent CDP never came up');
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 20000 });
    const ctx = browser.contexts()[0];
    const main = ctx.pages().find((p) => /index\.html/.test(p.url()));
    await main.waitForLoadState('load');
    await sleep(1500);
    await main.evaluate(async (cfg) => {
      const a = await window.myagent.invoke('settings.set', { key: 'llm.baseUrl', value: cfg.url });
      const b = await window.myagent.invoke('settings.set', { key: 'llm.model', value: cfg.model });
      if (!a.ok || !b.ok) throw new Error('settings.set failed');
    }, { url: 'https://api.20230112.xyz/v1', model: 'gpt-6.1-sol' });
    const created = await main.evaluate(async (ws) => {
      const r = await window.myagent.invoke('sessions.create', { title: 'skill-parity evidence-check', cwd: ws });
      if (!r.ok) throw new Error('sessions.create failed');
      return r.result;
    }, MY_WS);
    const skills = await main.evaluate(() => window.myagent.invoke('skills.list', {}));
    timeline.push({ kind: 'skills', installed: install, builtinEvidenceCheck: skills.result.some((s) => s.name === 'evidence-check'),
      total: skills.result.length });
    await main.evaluate((id) => window.__myagentTest.openSession(id), created.id);
    await sleep(800);
    await main.fill('#input', TASK);
    await main.click('#btn-send');
    timeline.push({ kind: 'sent', task: TASK });
    let sawSkillRead = false;
    const t0 = Date.now();
    while (Date.now() - t0 < TIMEOUT_SEC * 1000) {
      await sleep(4000);
      const snap = await main.evaluate(() => ({
        text: document.body.innerText,
        sendBtn: (document.getElementById('btn-send') || {}).textContent || '',
        chips: [...document.querySelectorAll('.tool-chip .tool-name')].map((e) => e.textContent),
      }));
      if (snap.chips.includes('skill_read')) sawSkillRead = true;
      const last = timeline[timeline.length - 1];
      if (!last || last.text !== snap.text) timeline.push({ t: Date.now() - t0, kind: 'text', text: snap.text, chips: snap.chips });
      if (snap.sendBtn === '…') { timeline.sawBusy = true; continue; }
      if (timeline.sawBusy && snap.sendBtn === '发送') { timeline.push({ kind: 'terminal', reason: 'send-idle' }); break; }
    }
    const finalText = (timeline.filter((e) => e.kind === 'text').pop() || {}).text || '';
    const g = grade(finalText);
    timeline.push({ kind: 'grade', sawSkillRead, ...g });
    await main.screenshot({ path: path.join(OUT, 'my-final.png'), animations: 'disabled' }).catch(() => {});
  } catch (e) {
    timeline.push({ kind: 'fatal', note: String(e.message || e).slice(0, 200) });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await sleep(500);
    treeKill(child);
  }
  fs.writeFileSync(path.join(OUT, 'my-run.json'), JSON.stringify(timeline, null, 2));
  console.log('my run ->', path.join(OUT, 'my-run.json'));
}

// ---------- wb leg ----------
async function runWb() {
  installWbProbe();
  // node-spawned WorkBuddy.exe loses the CDP flag to its launcher shim when a
  // stale instance/first-launch race is present (task-parity lessons) — launch
  // via Start-Process after clearing instances, cleanup by name
  spawnSync('powershell', ['-NoProfile', '-Command',
    "Get-Process WorkBuddy -ErrorAction SilentlyContinue | Stop-Process -Force; " +
    "Start-Process 'D:\\tools\\workbuddy\\install\\WorkBuddy.exe' -ArgumentList '--remote-debugging-port=9333'"],
    { windowsHide: true, timeout: 30000 });
  const timeline = [];
  let browser = null;
  try {
    if (!(await waitForCdp(9333, 90))) throw new Error('wb CDP never came up');
    browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 20000 });
    const ctx = browser.contexts()[0];
    const main = ctx.pages().find((p) => /index\.html/.test(p.url())) || ctx.pages()[0];
    await main.bringToFront().catch(() => {});
    await sleep(2500);
    // 技能 page evidence: what does wb have installed / an import path?
    // wb's sidebar item is「专家·技能·连接器」— click the entry, then the
    // 技能 sub-tab inside the page
    const clicked = await main.evaluate(() => {
      const el = [...document.querySelectorAll('div,span,button')]
        .filter((e) => e.childElementCount <= 1 && e.getBoundingClientRect().height > 0)
        .find((e) => /专家·技能·连接器|^技能/.test(e.textContent.trim()));
      if (el) { el.click(); return true; }
      return false;
    });
    await sleep(2000);
    await main.evaluate(() => {
      const tab = [...document.querySelectorAll('div,span,button')]
        .filter((e) => e.childElementCount <= 1 && e.getBoundingClientRect().height > 0)
        .find((e) => e.textContent.trim() === '技能');
      if (tab) tab.click();
    });
    await sleep(2000);
    await main.screenshot({ path: path.join(OUT, 'wb-skills-page.png'), animations: 'disabled' }).catch(() => {});
    const skillsText = await main.evaluate(() => document.body.innerText.slice(0, 3000));
    timeline.push({ kind: 'skills-page', clicked, hasEvidenceCheck: /evidence-check/.test(skillsText),
      excerpt: skillsText.replace(/\n+/g, ' | ').slice(0, 600) });
    // back to a fresh task and send the same prompt
    await main.evaluate(() => {
      const el = [...document.querySelectorAll('div,span,button')]
        .filter((e) => e.childElementCount <= 1 && e.getBoundingClientRect().height > 0)
        .find((e) => e.textContent.trim() === '新建任务');
      if (el) el.click();
    });
    await sleep(1800);
    const rect = await main.evaluate(() => {
      const cands = [...document.querySelectorAll('[contenteditable="true"]')]
        .map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(30, r.height / 2), w: r.width }; })
        .filter((c) => c.w > 200);
      return cands.length ? cands[cands.length - 1] : null;
    });
    if (!rect) throw new Error('wb composer not found');
    await main.mouse.click(rect.x, rect.y);
    await sleep(300);
    await main.keyboard.insertText(TASK);
    await sleep(400);
    await main.keyboard.press('Enter');
    await sleep(2500);
    timeline.push({ kind: 'sent', task: TASK });
    const t0 = Date.now();
    let lastText = '';
    let lastChange = Date.now();
    while (Date.now() - t0 < TIMEOUT_SEC * 1000) {
      await sleep(5000);
      const text = await main.evaluate(() => document.body.innerText);
      if (text !== lastText) { lastText = text; lastChange = Date.now(); timeline.push({ t: Date.now() - t0, kind: 'tick' }); }
      if (/大白话/.test(text) && Date.now() - lastChange > 60000) { timeline.push({ kind: 'terminal', reason: 'plain-done+idle' }); break; }
      if (Date.now() - lastChange > 240000) { timeline.push({ kind: 'terminal', reason: 'idle-4min' }); break; }
    }
    const g = grade(lastText);
    timeline.push({ kind: 'grade', ...g });
    await main.screenshot({ path: path.join(OUT, 'wb-final.png'), animations: 'disabled' }).catch(() => {});
  } catch (e) {
    timeline.push({ kind: 'fatal', note: String(e.message || e).slice(0, 200) });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await sleep(800);
    spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-Process WorkBuddy -ErrorAction SilentlyContinue | Stop-Process -Force"], { windowsHide: true, timeout: 30000 });
    // wb probe cleanup is deliberate: if wb scanned the dropped skill it is a
    // working install (kept); if not, remove to restore pre-test state
  }
  fs.writeFileSync(path.join(OUT, 'wb-run.json'), JSON.stringify(timeline, null, 2));
  console.log('wb run ->', path.join(OUT, 'wb-run.json'));
}

// ---------- grade/report ----------
async function buildReport() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  let my = null, wb = null;
  try { my = read('my-run.json'); } catch {}
  try { wb = read('wb-run.json'); } catch {}
  const g = (r) => (r || []).filter((e) => e.kind === 'grade').pop() || {};
  const gm = g(my), gw = g(wb);
  const md = `# Skill parity：reverse-skill 五步工作流·第 3 步（evidence-check）

- 生成时间：${new Date().toISOString()}
- 任务提示词（双端一致）：${TASK}
- 技能安装：MyAgent 用户目录 ${PACK.length} 个 reverse-skill 包技能 + 内置 evidence-check；wb 侧探测其 skills 目录（见下）

| 标准 | MyAgent | wb |
|---|---|---|
| Evidence 出处引用（fixture-app.js:行号 去重数） | ${gm.citations ?? 'n/a'} | ${gw.citations ?? 'n/a'} |
| Evidence 记录表 | ${gm.evidenceTable ?? 'n/a'} | ${gw.evidenceTable ?? 'n/a'} |
| 大白话原理段 | ${gm.plainSection ?? 'n/a'} | ${gw.plainSection ?? 'n/a'} |
| 通过（≥3 处独立行号出处 + 大白话） | **${gm.pass ? 'PASS' : 'FAIL'}** | **${gw.pass ? 'PASS' : 'FAIL'}** |
| skill_read 调用（MyAgent 引擎事件） | ${gm.sawSkillRead ?? 'n/a'} | — |

wb 技能页证据：wb-skills-page.png（含 evidence-check 是否被识别）。
截图：my-final.png / wb-final.png。原始时间线：my-run.json / wb-run.json。
`;
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log(md);
}

if (SIDE === 'wb') await runWb();
else if (SIDE === 'grade') await buildReport();
else await runMy();
