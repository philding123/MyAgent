'use strict';
// F59 computer use — OS-level primitives (design/43). WorkBuddy drives these
// through its kinfra-cua cloud; the personal replica runs a local loop:
// PowerShell P/Invoke for capture/input (zero new native deps; derived from
// the proven scripts/pixel-capture-win32.ps1 evidence pipeline).
//
// Safety shape (deliberate, mirrors the browser tool's ref discipline):
// - click/type/key target a WINDOW REF from this session's latest
//   list_windows (w1..wN) with coordinates INSIDE that window's rect — no
//   absolute desktop injection;
// - screenshot captures the primary screen scaled to ≤1280px wide;
// - non-win32 platforms and PowerShell failures are honest value errors.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ACTION_KINDS = {
  screenshot: 'read', list_windows: 'read',
  open_app: 'exec', click: 'exec', type: 'exec', key: 'exec',
};

// Compact native runtime — one PS file, commands: list/shot/click/key/front.
const PS = String.raw`
param([string]$Cmd, [int]$X=0, [int]$Y=0, [int]$Hwnd=0, [string]$Keys='', [string]$Out='', [string]$Target='')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
switch ($Cmd) {
  'list' {
    $found = New-Object System.Collections.ArrayList
    $cb = [W+EnumProc]{ param($h, $lp)
      if ([W]::IsWindowVisible($h)) {
        [uint32]$opid = 0
        [W]::GetWindowThreadProcessId($h, [ref]$opid) | Out-Null
        $t = New-Object System.Text.StringBuilder 256
        [W]::GetWindowText($h, $t, 256) | Out-Null
        $r = New-Object W+RECT
        [W]::GetWindowRect($h, [ref]$r) | Out-Null
        $title = $t.ToString()
        if ($title -ne '' -and ($r.R - $r.L) -gt 150 -and ($r.B - $r.T) -gt 100) {
          $proc = (Get-Process -Id $opid -ErrorAction SilentlyContinue).ProcessName
          [void]$found.Add([pscustomobject]@{ Hwnd = [int64]$h; Pid = $opid; Title = $title;
            Process = $proc; X = $r.L; Y = $r.T; W = ($r.R - $r.L); H = ($r.B - $r.T) })
        }
      }
      return $true
    }
    [W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
    Write-Output ($found | Select-Object -First 30 | ConvertTo-Json -Compress)
  }
  'open' {
    Start-Process -FilePath $Target
    Write-Output ('opened ' + $Target)
  }
  'shot' {
    # -Hwnd 0: primary screen via CopyFromScreen (fails on locked/headless
    # sessions with "invalid handle" — fall through to the error below);
    # -Hwnd N: PrintWindow(PW_RENDERFULLCONTENT) of that window's client —
    # renders the window's own DWM surface, proven to work occluded/locked.
    $wd = 0; $ht = 0; $bmp = $null
    if ($Hwnd -ne 0) {
      $r = New-Object W+RECT
      [W]::GetWindowRect([IntPtr]$Hwnd, [ref]$r) | Out-Null
      $wd = [Math]::Max(1, $r.R - $r.L); $ht = [Math]::Max(1, $r.B - $r.T)
      $bmp = New-Object System.Drawing.Bitmap($wd, $ht)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $hdc = $g.GetHdc()
      $ok = [W]::PrintWindow([IntPtr]$Hwnd, $hdc, 2)
      $g.ReleaseHdc($hdc); $g.Dispose()
      if (-not $ok) { throw 'PrintWindow failed' }
    } else {
      $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $wd = $b.Width; $ht = $b.Height
      $bmp = New-Object System.Drawing.Bitmap($wd, $ht)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
      $g.Dispose()
    }
    $maxW = 1280
    if ($bmp.Width -gt $maxW) {
      $h2 = [int]($bmp.Height * $maxW / $bmp.Width)
      $small = New-Object System.Drawing.Bitmap($maxW, $h2)
      $g2 = [System.Drawing.Graphics]::FromImage($small)
      $g2.DrawImage($bmp, 0, 0, $maxW, $h2)
      $g2.Dispose(); $bmp.Dispose(); $bmp = $small
    }
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ('shot ' + $wd + 'x' + $ht)
  }
  'click' {
    [W]::SetCursorPos($X, $Y) | Out-Null
    [W]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [W]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    Write-Output ('clicked ' + $X + ',' + $Y)
  }
  'key' {
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Write-Output 'keys sent'
  }
  'front' {
    [W]::SetForegroundWindow([IntPtr]$Hwnd) | Out-Null
    Start-Sleep -Milliseconds 250
    Write-Output 'fronted'
  }
}
`;

const SENDKEYS_SPECIAL = /[{}[\]()+^%~]/;
function toSendKeys(text) {
  // SendKeys treats {}[]()+^%~ as syntax — wrap each special char in braces
  let out = '';
  for (const ch of String(text)) out += SENDKEYS_SPECIAL.test(ch) ? '{' + ch + '}' : ch;
  return out;
}

const KEY_MAP = {
  enter: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}',
  home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}', space: ' ',
};
function comboToSendKeys(combo) {
  const parts = String(combo || '').toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  let prefix = '';
  for (const m of mods) {
    if (m === 'ctrl') prefix += '^';
    else if (m === 'alt') prefix += '%';
    else if (m === 'shift') prefix += '+';
    else return null;
  }
  if (key.length === 1) return prefix + (SENDKEYS_SPECIAL.test(key) ? '{' + key + '}' : key);
  if (!KEY_MAP[key]) return null;
  if (prefix) return null; // SendKeys cannot modify named keys reliably
  return KEY_MAP[key];
}

// document-ish targets refuse: this machine's association launch is broken
// (LIVE-05b) and opening user documents is present_file/preview's job
const DOC_EXT = /\.(docx?|pdf|xlsx?|pptx?|txt|md|csv|png|jpe?g|gif|webp|html?|zip|json)$/i;

function defaultExec(platform) {
  let psFile = null;
  return (args) => new Promise((resolve) => {
    if (platform !== 'win32') { resolve({ code: 1, stdout: '', stderr: 'computer use requires Windows (PowerShell runtime)' }); return; }
    try {
      if (!psFile) {
        psFile = path.join(os.tmpdir(), 'myagent-cu-' + process.pid + '.ps1');
        fs.writeFileSync(psFile, PS);
      }
    } catch (e) { resolve({ code: 1, stdout: '', stderr: e.message }); return; }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile, ...args],
      { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
        resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || '') });
      });
  });
}

function makeComputerTool(opts = {}) {
  const platform = opts.platform || process.platform;
  const exec = opts.exec || defaultExec(platform);
  let windows = []; // [{ref, hwnd, title, process, rect:{x,y,w,h}}]

  const runPs = async (args) => {
    const r = await exec(args);
    if (r.code !== 0) throw new Error(String(r.stderr || 'powershell failed').split('\n')[0].slice(0, 200));
    return r.stdout;
  };

  async function run(args) {
    const action = args.action;
    try {
      if (action === 'list_windows') {
        const out = await runPs(['-Cmd', 'list']);
        // ConvertTo-Json emits a bare object for a single hit — normalize
        const list = out.trim().startsWith('[') ? JSON.parse(out) : (out.trim() ? [JSON.parse(out)] : []);
        windows = list.slice(0, 30).map((w, i) => ({ ref: 'w' + (i + 1), hwnd: Number(w.Hwnd),
          title: String(w.Title || '').slice(0, 120), process: String(w.Process || ''),
          rect: { x: Number(w.X), y: Number(w.Y), w: Number(w.W), h: Number(w.H) } }));
        return { ok: true, summary: windows.length + ' windows (refs w1.. for click/type/key)',
          data: { windows: windows.map(({ ref, title, process, rect }) => ({ ref, title, process, rect })) } };
      }
      if (action === 'screenshot') {
        // optional ref: capture that window (PrintWindow — works locked/
        // occluded); without one, capture the primary screen, which fails
        // with an honest value on locked/headless sessions
        let hwnd = 0;
        if (args.ref) {
          const w = windows.find((x) => x.ref === args.ref);
          if (!w) return { ok: false, summary: 'unknown window ref: ' + args.ref + ' (run list_windows first)' };
          hwnd = w.hwnd;
        }
        const file = path.join(os.tmpdir(), 'myagent-cu-' + Date.now() + '.png');
        const shotArgs = ['-Cmd', 'shot', '-Out', file];
        if (hwnd) shotArgs.push('-Hwnd', String(hwnd));
        const out = await runPs(shotArgs);
        try {
          const b64 = fs.readFileSync(file).toString('base64');
          return { ok: true, summary: out.trim() + ' (' + Math.round(b64.length / 1024) + 'KB base64)'
            + (hwnd ? ' window ' + args.ref : ' primary screen'),
            data: { image: { mime: 'image/png', base64: b64 } } };
        } finally { try { fs.unlinkSync(file); } catch (_) {} }
      }
      if (action === 'open_app') {
        const target = String(args.target || '').trim();
        if (!target) return { ok: false, summary: 'open_app needs target' };
        if (DOC_EXT.test(target)) return { ok: false, summary: 'open_app is for applications; documents go through present_file/preview' };
        await runPs(['-Cmd', 'open', '-Target', target]);
        return { ok: true, summary: 'opened ' + target };
      }
      // window-scoped actions need a fresh list first
      const w = windows.find((x) => x.ref === args.ref);
      if (!w) return { ok: false, summary: 'unknown window ref: ' + args.ref + ' (run list_windows first)' };
      const rel = (v, max) => (Number.isInteger(v) ? v : Math.floor(max / 2));
      const x = rel(args.x, w.rect.w);
      const y = rel(args.y, w.rect.h);
      if (x < 0 || y < 0 || x >= w.rect.w || y >= w.rect.h) {
        return { ok: false, summary: 'coordinates outside the window rect (' + w.rect.w + 'x' + w.rect.h + ')' };
      }
      const ax = w.rect.x + x;
      const ay = w.rect.y + y;
      if (action === 'click') {
        await runPs(['-Cmd', 'front', '-Hwnd', String(w.hwnd)]);
        await runPs(['-Cmd', 'click', '-X', String(ax), '-Y', String(ay)]);
        return { ok: true, summary: 'clicked ' + args.ref + ' at ' + x + ',' + y + ' (window-relative)' };
      }
      if (action === 'type') {
        const text = String(args.text ?? '');
        if (!text) return { ok: false, summary: 'type needs text' };
        await runPs(['-Cmd', 'front', '-Hwnd', String(w.hwnd)]);
        await runPs(['-Cmd', 'click', '-X', String(ax), '-Y', String(ay)]);
        await runPs(['-Cmd', 'key', '-Keys', toSendKeys(text)]);
        return { ok: true, summary: 'typed ' + text.length + ' chars into ' + args.ref };
      }
      if (action === 'key') {
        const keys = comboToSendKeys(args.combo);
        if (!keys) return { ok: false, summary: 'unsupported key combo: ' + args.combo + ' (single keys, enter/tab/arrows..., ctrl/alt/shift + single char)' };
        await runPs(['-Cmd', 'front', '-Hwnd', String(w.hwnd)]);
        await runPs(['-Cmd', 'key', '-Keys', keys]);
        return { ok: true, summary: 'sent ' + args.combo + ' to ' + args.ref };
      }
      return { ok: false, summary: 'unknown action: ' + action + ' (valid: ' + Object.keys(ACTION_KINDS).join(',') + ')' };
    } catch (e) {
      return { ok: false, summary: 'computer ' + action + ' failed: ' + String(e && e.message || e) };
    }
  }

  return {
    kind: 'read', // screenshot/list_windows readable; exec actions via kindOf
    kindOf: (args) => ACTION_KINDS[args.action] || 'read',
    description: 'Computer use (OS-level). Actions: screenshot[ref] list_windows open_app{target} click{ref,x,y} type{ref,text[,x,y]} key{ref,combo}. refs come from list_windows; x/y are window-relative; screenshot without ref captures the primary screen, with ref captures that window. Applications only for open_app.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: Object.keys(ACTION_KINDS) },
        target: { type: 'string' }, ref: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, text: { type: 'string' }, combo: { type: 'string' },
      },
      required: ['action'],
    },
    run,
  };
}

module.exports = { makeComputerTool, computerActionKinds: ACTION_KINDS, toSendKeys, comboToSendKeys };
