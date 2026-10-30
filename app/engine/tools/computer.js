'use strict';
// F59 computer use — OS-level primitives (design/43). WorkBuddy drives these
// through its kinfra-cua cloud; the personal replica runs a local loop:
// PowerShell P/Invoke for capture/input (zero new native deps; derived from
// the proven scripts/pixel-capture-win32.ps1 evidence pipeline).
//
// Safety shape (deliberate, mirrors the browser tool's ref discipline):
// - click/type/key target a WINDOW REF from this session's latest
//   list_windows (w1..wN) with coordinates INSIDE that window — no absolute
//   desktop injection. x/y are pixels of that window's screenshot (windows
//   wider than 1280px are captured downscaled, so x/y are scaled back here);
// - input is injected only after the target is VERIFIED foreground (Windows'
//   focus lock often refuses SetForegroundWindow from a background process —
//   injecting anyway would hit whatever app is in front) and at its LIVE
//   position; a resized window refuses (the model's screenshot is stale);
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

// Compact native runtime — one PS file, commands: list/open/shot/click/type/key.
// click/type/key run Front first inside the SAME invocation (no gap between
// the foreground check and the input).
const PS = String.raw`
param([string]$Cmd, [int]$X=0, [int]$Y=0, [long]$Hwnd=0, [int]$ExpW=0, [int]$ExpH=0, [string]$Keys='', [string]$Out='', [string]$Target='')
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
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
# Bring $Hwnd to the front and PROVE it got there; returns its live rect.
# Throws WINDOW_GONE / NOT_FOREGROUND / RESIZED wxh (mapped to values in JS).
function Front {
  $hw = [IntPtr]$Hwnd
  if (-not [W]::IsWindow($hw)) { throw 'WINDOW_GONE' }
  [W]::SetForegroundWindow($hw) | Out-Null
  Start-Sleep -Milliseconds 250
  if ([W]::GetForegroundWindow().ToInt64() -ne $Hwnd) { throw 'NOT_FOREGROUND' }
  $r = New-Object W+RECT
  [W]::GetWindowRect($hw, [ref]$r) | Out-Null
  if ($ExpW -gt 0 -and ((($r.R - $r.L) -ne $ExpW) -or (($r.B - $r.T) -ne $ExpH))) {
    throw ('RESIZED ' + ($r.R - $r.L) + 'x' + ($r.B - $r.T))
  }
  return $r
}
function Click($r) {
  $ax = $r.L + $X; $ay = $r.T + $Y
  [W]::SetCursorPos($ax, $ay) | Out-Null
  [W]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [W]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  return ('clicked ' + $ax + ',' + $ay)
}
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
    $r = Front
    Write-Output (Click $r)
  }
  'type' {
    $r = Front
    Click $r | Out-Null
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Write-Output 'typed'
  }
  'key' {
    Front | Out-Null
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Write-Output 'keys sent'
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

// Screenshot coordinate space of a window: the PS shot downscales anything
// wider than SHOT_MAX_W (same rounding as its [int] cast), so model x/y live
// in that space and scale back to window pixels by `s`.
const SHOT_MAX_W = 1280;
function coordSpace(rect) {
  if (rect.w <= SHOT_MAX_W) return { s: 1, w: rect.w, h: rect.h };
  return { s: rect.w / SHOT_MAX_W, w: SHOT_MAX_W, h: Math.max(1, Math.round(rect.h * SHOT_MAX_W / rect.w)) };
}

// Front failures → values that say nothing was injected and what to do
function frontError(ref, message) {
  if (/NOT_FOREGROUND/.test(message)) {
    return 'window ' + ref + ' could not be brought to the foreground (Windows focus lock) — nothing was sent; '
      + 'ask the user to click that window once, then retry';
  }
  if (/WINDOW_GONE/.test(message)) return 'window ' + ref + ' no longer exists — run list_windows again';
  const resized = /RESIZED (\d+)x(\d+)/.exec(message);
  if (resized) {
    return 'window ' + ref + ' was resized since list_windows (now ' + resized[1] + 'x' + resized[2]
      + ') — nothing was sent; run list_windows and take a new screenshot';
  }
  return null;
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
          data: { windows: windows.map(({ ref, title, process, rect }) => {
            const cs = coordSpace(rect);
            return { ref, title, process, rect, coords: { w: cs.w, h: cs.h } };
          }) } };
      }
      if (action === 'screenshot') {
        // optional ref: capture that window (PrintWindow — works locked/
        // occluded); without one, capture the primary screen, which fails
        // with an honest value on locked/headless sessions
        let hwnd = 0;
        let cs = null;
        if (args.ref) {
          const w = windows.find((x) => x.ref === args.ref);
          if (!w) return { ok: false, summary: 'unknown window ref: ' + args.ref + ' (run list_windows first)' };
          hwnd = w.hwnd;
          cs = coordSpace(w.rect);
        }
        const file = path.join(os.tmpdir(), 'myagent-cu-' + Date.now() + '.png');
        const shotArgs = ['-Cmd', 'shot', '-Out', file];
        if (hwnd) shotArgs.push('-Hwnd', String(hwnd));
        const out = await runPs(shotArgs);
        try {
          const b64 = fs.readFileSync(file).toString('base64');
          return { ok: true, summary: out.trim() + ' (' + Math.round(b64.length / 1024) + 'KB base64)'
            + (hwnd ? ' window ' + args.ref + '; image ' + cs.w + 'x' + cs.h + ' = the x/y space for click/type' : ' primary screen'),
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
      const cs = coordSpace(w.rect);
      const rel = (v, max) => (Number.isInteger(v) ? v : Math.floor(max / 2));
      const x = rel(args.x, cs.w);
      const y = rel(args.y, cs.h);
      if (x < 0 || y < 0 || x >= cs.w || y >= cs.h) {
        return { ok: false, summary: 'coordinates outside the window (' + cs.w + 'x' + cs.h + ' screenshot pixels)' };
      }
      // screenshot pixels → window pixels; PS adds the LIVE window origin
      const at = ['-Hwnd', String(w.hwnd), '-ExpW', String(w.rect.w), '-ExpH', String(w.rect.h),
        '-X', String(Math.min(w.rect.w - 1, Math.round(x * cs.s))), '-Y', String(Math.min(w.rect.h - 1, Math.round(y * cs.s)))];
      const guarded = async (psArgs) => {
        try { await runPs(psArgs); return null; } catch (e) {
          const msg = frontError(args.ref, String(e && e.message || e));
          if (msg) return { ok: false, summary: msg };
          throw e;
        }
      };
      if (action === 'click') {
        return (await guarded(['-Cmd', 'click', ...at]))
          || { ok: true, summary: 'clicked ' + args.ref + ' at ' + x + ',' + y + ' (screenshot pixels)' };
      }
      if (action === 'type') {
        const text = String(args.text ?? '');
        if (!text) return { ok: false, summary: 'type needs text' };
        return (await guarded(['-Cmd', 'type', ...at, '-Keys', toSendKeys(text)]))
          || { ok: true, summary: 'typed ' + text.length + ' chars into ' + args.ref };
      }
      if (action === 'key') {
        const keys = comboToSendKeys(args.combo);
        if (!keys) return { ok: false, summary: 'unsupported key combo: ' + args.combo + ' (single keys, enter/tab/arrows..., ctrl/alt/shift + single char)' };
        return (await guarded(['-Cmd', 'key', '-Hwnd', String(w.hwnd), '-Keys', keys]))
          || { ok: true, summary: 'sent ' + args.combo + ' to ' + args.ref };
      }
      return { ok: false, summary: 'unknown action: ' + action + ' (valid: ' + Object.keys(ACTION_KINDS).join(',') + ')' };
    } catch (e) {
      return { ok: false, summary: 'computer ' + action + ' failed: ' + String(e && e.message || e) };
    }
  }

  return {
    kind: 'read', // screenshot/list_windows readable; exec actions via kindOf
    kindOf: (args) => ACTION_KINDS[args.action] || 'read',
    description: 'Computer use (OS-level). Actions: screenshot[ref] list_windows open_app{target} click{ref,x,y} type{ref,text[,x,y]} key{ref,combo}. refs come from list_windows; x/y are pixels of that window ref screenshot (list_windows coords gives that size; windows wider than 1280px are downscaled); screenshot without ref captures the primary screen, with ref captures that window. Applications only for open_app.',
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

module.exports = { makeComputerTool, computerActionKinds: ACTION_KINDS, toSendKeys, comboToSendKeys, coordSpace };
