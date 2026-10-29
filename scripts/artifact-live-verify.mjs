#!/usr/bin/env node
// Real-machine (实机) verification for the F55 artifact-center path actions.
// The button audit runs with MYAGENT_TEST_SEAMS=1: native actions are recorded
// instead of executed. This harness deliberately runs WITHOUT seams so that
//   打开所在文件夹  → a real Explorer window selects the delivered file,
//   默认应用打开    → a real native confirm dialog decides, approve launches
//                     the real default application,
//   复制路径        → the real OS clipboard holds the exact path.
// OS-level assertions are made from PowerShell (window/process/clipboard),
// not from the renderer. Evidence lands in artifacts/artifact-center-live/.
//   node scripts/artifact-live-verify.mjs [--port 9345] [--out artifacts/artifact-center-live] [--exec <packaged binary>]
import { chromium } from 'playwright-core';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const PORT = opt('port', '9345');
const OUT = path.resolve(opt('out', path.join(ROOT, 'artifacts', 'artifact-center-live')));
fs.mkdirSync(OUT, { recursive: true });
// each run's evidence is self-contained: drop screenshots of previous runs
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
if (process.platform !== 'win32') { console.error('real-machine harness is Windows-only'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let shotN = 0;

const DIALOG_TITLE = '打开产物';
const DENY_BUTTON = '取消';
const APPROVE_BUTTON = '打开';
const FILE_NAME = '实机 交付 报告.txt';

// ---------- PowerShell helpers (written as UTF-8 BOM .ps1 so Chinese survives) ----------
const writePs = (name, src) => { const p = path.join(OUT, name); fs.writeFileSync(p, '\ufeff' + src); return p; };
const ps = {
  screen: writePs('shot-screen.ps1', `
param([string]$OutPath)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)
$bmp.Save($OutPath,[System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose();$bmp.Dispose()`),
  dialog: writePs('dialog-answer.ps1', `
param([string]$OwnerPids,[string]$Title,[string]$Button,[string]$ShotPath)
# Wait for the native confirm dialog (#32770) owned by one of our Electron
# processes, screenshot it, then click the named button. UIAutomation's root
# children enumeration does not surface #32770 dialogs reliably, so locate the
# window via EnumWindows (class + title + pid) and drive it FromHandle.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public struct RCAP { public int L, T, R, B; }
public class WFind {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, ref RCAP r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public static IntPtr Find(string pids, string title) {
    var found = IntPtr.Zero;
    var want = new System.Collections.Generic.HashSet<int>();
    foreach (var p in pids.Split(',')) { int v; if (int.TryParse(p, out v)) want.Add(v); }
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (want.Contains((int)p)) {
        var t = new StringBuilder(256); GetWindowText(h, t, 256);
        var c = new StringBuilder(64); GetClassName(h, c, 64);
        if (c.ToString() == "#32770" && t.ToString() == title && IsWindowVisible(h)) found = h;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[void][WFind]::SetProcessDPIAware()
function Shot([string]$p,[IntPtr]$Hwnd) {
  # Capture the dialog itself by handle (PrintWindow works regardless of
  # foreground/animation state); screen copy is only the fallback. A failed
  # evidence shot must never abort the actual dialog answer.
  for($i=0; $i -lt 3; $i++) {
    try {
      if ($Hwnd -ne [IntPtr]::Zero) {
        $r=New-Object RCAP
        [void][WFind]::GetWindowRect($Hwnd,[ref]$r)
        $w=$r.R-$r.L; $h=$r.B-$r.T
        if($w -gt 0 -and $h -gt 0){
          $bmp=New-Object System.Drawing.Bitmap $w,$h
          $g=[System.Drawing.Graphics]::FromImage($bmp)
          $hdc=$g.GetHdc()
          [void][WFind]::PrintWindow($Hwnd,$hdc,2)
          $g.ReleaseHdc($hdc)
          $bmp.Save($p,[System.Drawing.Imaging.ImageFormat]::Png)
          $g.Dispose();$bmp.Dispose()
          return
        }
      }
      $b=[System.Windows.Forms.SystemInformation]::VirtualScreen
      $bmp2=New-Object System.Drawing.Bitmap $b.Width,$b.Height
      $g2=[System.Drawing.Graphics]::FromImage($bmp2)
      $g2.CopyFromScreen($b.X,$b.Y,0,0,$bmp2.Size)
      $bmp2.Save($p,[System.Drawing.Imaging.ImageFormat]::Png)
      $g2.Dispose();$bmp2.Dispose()
      return
    } catch { Start-Sleep -Milliseconds 400 }
  }
  Write-Output ('SHOT_FAILED ' + $_.Exception.Message)
}
$hwnd=[WFind]::Find($OwnerPids,$Title)
$deadline=(Get-Date).AddSeconds(25)
while((Get-Date) -lt $deadline -and $hwnd -eq [IntPtr]::Zero){
  Start-Sleep -Milliseconds 250
  $hwnd=[WFind]::Find($OwnerPids,$Title)
}
if($hwnd -eq [IntPtr]::Zero){ Write-Output 'DIALOG_NOT_FOUND'; exit 3 }
if ($ShotPath) { Shot $ShotPath $hwnd }
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WClick {
  public delegate bool EnumChildProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumChildProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public delegate void Found(IntPtr h, string text);
  public static string ClickButton(IntPtr parent, string label) {
    var hit = IntPtr.Zero; var all = new StringBuilder();
    EnumChildWindows(parent, (h, l) => {
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      if (c.ToString() == "Button") {
        all.Append('[').Append(t).Append(']');
        if (t.ToString() == label && hit == IntPtr.Zero) hit = h;
      }
      return true;
    }, IntPtr.Zero);
    if (hit != IntPtr.Zero) { PostMessage(hit, 0x00F5 /* BM_CLICK */, IntPtr.Zero, IntPtr.Zero); return "CLICKED"; }
    return "BUTTONS" + all.ToString();
  }
}
"@
$result=[WClick]::ClickButton($hwnd,$Button)
if($result -eq 'CLICKED'){ Write-Output 'CLICKED'; exit 0 }
Write-Output ('BUTTON_NOT_FOUND ' + $result); exit 4`),
  explorerFind: writePs('explorer-find.ps1', `
param([string]$Dir)
# How many Explorer windows are currently showing exactly this folder?
$shell=New-Object -ComObject Shell.Application
$n=0
foreach($w in $shell.Windows()){
  try{
    $loc=[string]$w.LocationURL
    if(-not $loc.StartsWith('file:///')){ continue }
    $p=[uri]::UnescapeDataString($loc) -replace '^file:///',''
    $p=$p -replace '/','\\'
    if($p -ieq $Dir){ $n++ }
  }catch{}
}
Write-Output $n`),
  explorerClose: writePs('explorer-close.ps1', `
param([string]$Dir)
$shell=New-Object -ComObject Shell.Application
$n=0
foreach($w in @($shell.Windows())){
  try{
    $loc=[string]$w.LocationURL
    if(-not $loc.StartsWith('file:///')){ continue }
    $p=[uri]::UnescapeDataString($loc) -replace '^file:///',''
    $p=$p -replace '/','\\'
    if($p -ieq $Dir){ $w.Quit(); $n++ }
  }catch{}
}
Start-Sleep -Milliseconds 500
Write-Output $n`),
  clipboard: writePs('clipboard-get.ps1', `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Write-Output ([System.Windows.Forms.Clipboard]::GetText())`),
  procs: writePs('procs-with.ps1', `
param([string]$Needle)
# One "pid|name" line per process whose command line mentions the needle.
# Exclude this probe itself: its own command line carries the needle as an arg.
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Get-CimInstance Win32_Process -Filter "CommandLine IS NOT NULL" |
  Where-Object { $_.CommandLine -like ('*'+$Needle+'*') -and $_.CommandLine -notlike '*procs-with.ps1*' } |
  ForEach-Object { Write-Output ($_.ProcessId.ToString()+'|'+$_.Name) }`),
  winTitle: writePs('win-title.ps1', `
param([string]$Needle)
# Visible top-level windows whose title contains the needle (UTF-8 out).
# The default application's window title carries the file name whatever path
# form (long or 8.3) the shell handed it.
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WTitle {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public static void Find(string needle, System.Collections.Generic.List<string> outList) {
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      var title = t.ToString();
      if (IsWindowVisible(h) && title.Length > 0 && title.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) {
        using (var proc = System.Diagnostics.Process.GetProcessById((int)p)) {
          outList.Add(p + "|" + proc.ProcessName + "|" + title);
        }
      }
      return true;
    }, IntPtr.Zero);
  }
}
"@
$hits=New-Object System.Collections.Generic.List[string]
[WTitle]::Find($Needle,$hits)
$hits | ForEach-Object { Write-Output $_ }`),
  direct: writePs('direct-run.ps1', `
param([string]$FilePath,[string]$ArgumentList)
Start-Process -FilePath $FilePath -ArgumentList $ArgumentList
Write-Output 'STARTED'`),
  killNotepad: writePs('kill-notepad.ps1', `
param([string]$Match)
Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like ('*'+$Match+'*') } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output 'OK'`),
};
const runPs = (file, ...psArgs) => new Promise((resolve) => {
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...psArgs],
    { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, out: String(stdout || '').trim(), err: String(stderr || '').trim() }));
});
const screenShot = (label) => runPs(ps.screen, '-OutPath', path.join(OUT, `${String(++shotN).padStart(2, '0')}-${label}.png`));
const procsWith = async (needle) => (await runPs(ps.procs, '-Needle', needle)).out.split(/\r?\n/).filter((l) => /^\d+\|/.test(l));
const windowsWithTitle = async (needle) => (await runPs(ps.winTitle, '-Needle', needle)).out.split(/\r?\n/).filter((l) => /^\d+\|/.test(l));
// node electron/cli.js re-spawns the real electron.exe: the native dialog is
// owned by that grandchild, so resolve the electron pid set by command line.
const electronPids = async () => {
  const all = await procsWith(`--remote-debugging-port=${PORT}`);
  const pids = all.map((l) => l.split('|')).filter(([, name]) => !/node(\.exe)?$/i.test(name)).map(([pid]) => pid);
  return pids.length ? pids : [String(child.pid)];
};

// ---------- fixtures ----------
const { startMockLlm } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'mock-llm.mjs')).href);
const mock = await startMockLlm();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-live-'));
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'myagent-live-fx-'));
const wsDir = path.join(fx, '实机 工作空间');
fs.mkdirSync(wsDir);
const sourceFile = path.join(wsDir, FILE_NAME);
fs.writeFileSync(sourceFile, 'REAL_MACHINE_DELIVERY_TOKEN_42\n实机交付内容,验证中文与空格路径。\n');
// Chinese + spaces in the delivery root too: the real Explorer must handle it
const deliveryRoot = path.join(fx, '实机 交付目录');

// ---------- launch (visible, NO test seams → real native actions) ----------
const electronJs = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
const EXEC = opt('exec', null);
let cmd = EXEC ? path.resolve(EXEC) : process.execPath;
const cmdArgs = [...(EXEC ? [] : [electronJs, '.']), `--remote-debugging-port=${PORT}`,
  // this machine's visible launches require no-sandbox + disable-gpu (see project memory)
  '--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'];
const child = spawn(cmd, cmdArgs, {
  cwd: ROOT, stdio: 'ignore',
  env: { ...process.env, MYAGENT_HOME: home, MYAGENT_DELIVERY_DIR: deliveryRoot },
});
const killTree = () => { try { child.kill(); } catch {} };

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(1000);
  try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch {}
}
if (!up) { console.error('CDP never came up'); killTree(); process.exit(2); }
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 30000 });
const ctx = browser.contexts()[0];

async function until(fn, ms = 6000, label = 'condition') {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(150); }
  throw new Error('timeout waiting for ' + label + (last instanceof Error ? ' (' + last.message + ')' : ''));
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const findPage = (re) => ctx.pages().find((p) => re.test(p.url()));
const main = await until(() => findPage(/index\.html/), 20000, 'main window');
await main.waitForLoadState('load');
await until(() => main.evaluate(() => !!window.__myagentTest), 10000, 'renderer ready');
const rpc = (method, params) => main.evaluate(([m, p]) => window.myagent.invoke(m, p)
  .then((r) => (r.ok ? r.result : Promise.reject(new Error((r.error && r.error.message) || 'rpc error')))), [method, params || {}]);
await rpc('settings.set', { key: 'llm.baseUrl', value: mock.baseUrl });
await rpc('settings.set', { key: 'llm.model', value: 'live-model' });
await main.setViewportSize({ width: 1280, height: 800 });

let section = '';
async function live(id, name, fn) {
  try {
    const note = await fn();
    results.push({ section, id, name, pass: true, note: note || '' });
    console.log('PASS ' + id + ' — ' + (note || ''));
  } catch (e) {
    results.push({ section, id, name, pass: false, note: String(e.message || e).slice(0, 400) });
    console.log('FAIL ' + id + ' — ' + String(e.message || e).slice(0, 300));
    await main.screenshot({ path: path.join(OUT, `fail-${id}.png`) }).catch(() => {});
    await statusText().then((t) => console.log('     #artifact-status = "' + t + '"')).catch(() => {});
  }
}
const appShot = (label) => main.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-${label}.png`) }).catch(() => {});
const waitDone = () => until(() => main.evaluate(() =>
  !document.getElementById('btn-send').disabled && document.getElementById('progress-line').classList.contains('hidden')), 15000, 'engine turn done');
const statusText = () => main.locator('#artifact-status').textContent();

// ---------- the delivery turn ----------
section = '实机 · 交付与登记';
const session = await rpc('sessions.create', { title: '实机-产物验证', cwd: wsDir });
mock.push([
  { content: '', tool_calls: [{ id: 'live-deliver', type: 'function', function: { name: 'present_file', arguments: JSON.stringify({ path: sourceFile }) } }] },
  { content: '已交付实机文件' },
]);
await main.evaluate((id) => window.__myagentTest.openSession(id), session.id);
await main.fill('#input', '交付这个文件');
await main.click('#btn-send');
await waitDone();

const findDelivered = () => {
  const stamp = fs.readdirSync(deliveryRoot).filter((d) => fs.statSync(path.join(deliveryRoot, d)).isDirectory());
  for (const d of stamp) {
    const p = path.join(deliveryRoot, d, FILE_NAME);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

let deliveredPath = null;
await live('LIVE-01', '交付成功自动登记,产物面板预览(中文+空格路径)', async () => {
  deliveredPath = await until(findDelivered, 6000, 'delivered copy on disk');
  const list = await rpc('artifacts.list', { sessionId: session.id });
  expect(Array.isArray(list) && list.length === 1, 'artifacts.list count=' + (list && list.length));
  expect(path.resolve(list[0].path) === path.resolve(deliveredPath), 'registry path mismatch');
  await until(() => main.evaluate(() => !document.getElementById('artifact-panel').classList.contains('hidden')
    && document.querySelectorAll('#artifact-list .artifact-item').length === 1), 6000, 'panel with one item');
  const state = () => main.evaluate(() => ({ status: document.getElementById('artifact-status').textContent,
    preview: document.getElementById('artifact-preview').textContent.slice(0, 120) }));
  const s = await until(() => state().then((st) => (st.preview.includes('REAL_MACHINE_DELIVERY_TOKEN_42') ? st : null)),
    8000, 'preview content').catch(async () => { throw new Error('preview content — ' + JSON.stringify(await state())); });
  void s;
  await appShot('delivered-panel');
  return 'delivered=' + deliveredPath;
});

section = '实机 · 路径操作';
await live('LIVE-02', '复制路径 → 真实剪贴板内容与产物路径完全一致', async () => {
  await main.click('#artifact-copy');
  await until(() => statusText().then((t) => t.includes('已复制')), 6000, 'copy status');
  const clip = (await runPs(ps.clipboard)).out;
  expect(clip === deliveredPath, `clipboard "${clip}" !== "${deliveredPath}"`);
  return 'clipboard matches (Chinese+spaces preserved)';
});

await live('LIVE-03', '打开所在文件夹 → 真实资源管理器定位交付文件所在目录', async () => {
  await main.click('#artifact-reveal');
  await until(() => statusText().then((t) => t.includes('已请求在文件管理器中定位')), 6000, 'reveal status');
  const dir = path.dirname(deliveredPath);
  const n = await until(async () => (await runPs(ps.explorerFind, '-Dir', dir)).out === '1' ? 1 : null, 10000, 'real Explorer window on ' + dir);
  await screenShot('explorer-revealed');
  const closed = (await runPs(ps.explorerClose, '-Dir', dir)).out;
  expect(n === 1 && Number(closed) >= 1, `explorer windows=${n} closed=${closed}`);
  return `real Explorer opened ${dir} and was closed (${closed})`;
});

let procsBefore = [];
await live('LIVE-04', '默认应用打开·拒绝 → 原生确认弹窗出现,取消后不启动任何程序', async () => {
  procsBefore = await procsWith(deliveredPath);
  await main.click('#artifact-open');
  await sleep(600);
  console.log('     status@600ms = "' + (await statusText()) + '"');
  const denyShot = path.join(OUT, `${String(shotN + 1).padStart(2, '0')}-dialog-deny.png`);
  const answer = await runPs(ps.dialog, '-OwnerPids', (await electronPids()).join(','), '-Title', DIALOG_TITLE,
    '-Button', DENY_BUTTON, '-ShotPath', denyShot);
  shotN++;
  expect(answer.code === 0 && answer.out.split(/\r?\n/).includes('CLICKED'), 'dialog answer failed: ' + answer.out + ' ' + answer.err);
  await until(() => statusText().then((t) => /not approved|拒绝|取消|denied|timeout/i.test(t)), 6000, 'denied status');
  await sleep(1200); // any launch would show up immediately
  const after = await procsWith(deliveredPath);
  expect(after.length === procsBefore.length, `processes with path: ${procsBefore.length} -> ${after.length} (${after.join(', ')})`);
  return `native dialog shown${fs.existsSync(denyShot) ? ' (screenshot)' : ' (screen capture unavailable this run)'}, 取消 honored, nothing launched`;
});

await live('LIVE-05', '默认应用打开·批准 → 应用链路真实执行(原生弹窗批准→openPath 成功)', async () => {
  const baseName = path.basename(deliveredPath, '.txt');
  await main.click('#artifact-open');
  const answer = await runPs(ps.dialog, '-OwnerPids', (await electronPids()).join(','), '-Title', DIALOG_TITLE,
    '-Button', APPROVE_BUTTON, '-ShotPath', path.join(OUT, `${String(shotN + 1).padStart(2, '0')}-dialog-approve.png`));
  shotN++;
  expect(answer.code === 0 && answer.out.split(/\r?\n/).includes('CLICKED'), 'dialog answer failed: ' + answer.out + ' ' + answer.err);
  // shell.openPath resolved without error AND the renderer reports success —
  // the app-side chain (user click → native approval → OS open call) is done.
  await until(() => statusText().then((t) => t.includes('已请求使用默认应用打开')), 8000, 'open status');
  // Best effort: the default application's window (title carries the file
  // name whatever path form the shell handed it). Recorded by LIVE-05b.
  const window = await windowsWithTitle(baseName).then((ws) => ws[0] || null).catch(() => null);
  if (window) {
    await screenShot('default-app-open');
    const pid = Number(window.split('|')[0]);
    try { process.kill(pid); } catch {}
    return `opened "${window.split('|').slice(1).join(' | ')}" (killed after evidence)`;
  }
  return 'app chain complete; default-app window not observed — see LIVE-05b environment probe';
});

await live('LIVE-05b', '环境探测:是否观察到默认应用窗口(失败需结合独立对照归因)', async () => {
  const baseName = path.basename(deliveredPath, '.txt');
  const window = await until(() => windowsWithTitle(baseName).then((ws) => (ws.length ? ws[0] : null)),
    8000, 'default-application window titled with the file name').catch(() => null);
  if (window) return 'default application window observed: ' + window.split('|').slice(1).join(' | ');
  throw new Error('no matching default-application window observed; consult independent association-launch probes before attributing the cause');
});

// ---------- machine control probes (attribution for LIVE-05b) ----------
// Same session, same user, same desktop: launching an executable directly
// must work, while opening a document BY ASSOCIATION is what LIVE-05b needs.
// Both probes run here so the report carries self-contained evidence.
killTree();
await mock.close().catch(() => {});
const envProbes = [];
try {
  const control = path.join(fx, 'live-control.txt');
  fs.writeFileSync(control, 'association control probe');
  const direct = await runPs(ps.direct, '-FilePath', 'notepad.exe', '-ArgumentList', control);
  await sleep(2500);
  const directWin = (await windowsWithTitle('live-control')).length;
  envProbes.push({ probe: 'direct exe launch (Start-Process notepad.exe <file>)', result: direct.code === 0 && directWin >= 1 ? 'works' : 'failed', windows: directWin });
  await runPs(ps.killNotepad, '-Match', 'live-control').catch(() => {});
  await sleep(800);
  const assoc = await runPs(ps.direct, '-FilePath', control);
  await sleep(2500);
  const assocWin = (await windowsWithTitle('live-control')).length;
  envProbes.push({ probe: 'association launch (Start-Process <file.txt>)', result: assoc.code === 0 && assocWin >= 1 ? 'works' : 'silently no-op', windows: assocWin, note: 'exit code ' + assoc.code });
  await runPs(ps.killNotepad, '-Match', 'live-control').catch(() => {});
} catch (e) { envProbes.push({ probe: 'control probes', result: 'error', note: String(e.message || e) }); }

// ---------- report ----------

// close any Explorer window our delivery opened, as cleanup
try { await runPs(ps.explorerClose, '-Dir', path.dirname(deliveredPath)); } catch {}

const { execFileSync } = await import('node:child_process');
const meta = {
  date: new Date().toISOString(),
  platform: process.platform,
  branch: (() => { try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim(); } catch { return 'unknown'; } })(),
  head: (() => { try { return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD']).toString().trim().slice(0, 12); } catch { return 'unknown'; } })(),
  dirty: (() => { try { return execFileSync('git', ['-C', ROOT, 'status', '--porcelain']).toString().trim().split('\n').length; } catch { return -1; } })(),
  exec: EXEC || 'dev checkout (electron .)',
  seams: 'OFF — real native actions',
  deliveredPath,
};
const pass = results.filter((r) => r.pass).length;
const envBroken = envProbes.some((p) => p.result === 'silently no-op');
const lines = [
  '# F55 产物中心 Windows 实机验证报告', '',
  `- 时间: ${meta.date};平台: ${meta.platform};结果: ${pass}/${results.length} PASS`,
  `- 运行来源: ${meta.exec};分支 ${meta.branch}@${meta.head}(未提交改动 ${meta.dirty} 项)`,
  `- MYAGENT_TEST_SEAMS 未设置 — 打开所在文件夹/默认应用打开/复制路径均为真实操作系统动作,PowerShell 从窗口/进程/剪贴板断言,非接缝记录。`, '',
  '| 用例 | 断言 | 结果 | 实测 |', '|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.name} | ${r.pass ? 'PASS' : (envBroken && r.id === 'LIVE-05b' ? 'FAIL(环境归因)' : '**FAIL**')} | ${r.note.replace(/\|/g, '\\|')} |`),
  '',
  `产物路径: \`${deliveredPath}\``, '',
  '## 本机关联启动对照探针(为 LIVE-05b 归因,报告生成时实测)', '',
  ...envProbes.map((p) => `- ${p.probe}: **${p.result}**(窗口数 ${p.windows ?? '-'}${p.note ? ',' + p.note : ''})`),
  '',
  envBroken
    ? '独立对照中，直接启动 notepad.exe 可观察到窗口，而 Start-Process 文件.txt 未观察到匹配窗口；这支持本机关联启动存在环境问题，但不证明所有启动方式均失效，也不保证修复关联后必然通过。LIVE-04/05 仅证明原生确认与 openPath 无错误返回，默认应用最终可见效果仍未通过。'
    : '本机关联启动可用,LIVE-05b 结果即为默认应用真实行为。',
  '',
  '截图(应用内为 Playwright 截取,弹窗与资源管理器为整屏截图):',
  ...fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort().map((f) => `- ${f}`),
  '',
  '本报告由 scripts/artifact-live-verify.mjs 生成;单元/集成/接缝审计见 artifacts/acceptance-report.md 与 artifacts/button-audit/。',
];
fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ meta, results, envProbes }, null, 2));
console.log(`\n${pass}/${results.length} PASS — report: ${path.join(OUT, 'report.md')}`);
process.exit(pass === results.length ? 0 : 1);
