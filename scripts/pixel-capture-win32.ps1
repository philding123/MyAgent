# Win32 pixel-capture pipeline (design/27 evidence): enumerate an app's
# top-level windows, normalize client size, and BitBlt the client area from
# the screen DC. Works identically for WorkBuddy (protected process, no CDP)
# and MyAgent, so both sides of the comparison share one evidence pipeline.
param(
  [Parameter(Position=0, Mandatory=$true)][string]$Cmd,  # list|shot|resize|click|key|front
  [string]$Proc,
  [string]$Title = '',
  [int]$Hwnd = 0,
  [int]$W = 0, [int]$H = 0,           # client size for resize / region for click is screen-abs
  [int]$X = 0, [int]$Y = 0,           # screen coords for click
  [string]$Keys = '',
  [string]$Out = 'artifacts\pixel-evidence',
  [string]$Prefix = 'app',
  [switch]$All
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr h, uint m, UIntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, UIntPtr w, IntPtr l);
  [DllImport("dwmapi.dll")] public static extern int DwmRegisterThumbnail(IntPtr dst, IntPtr src, out IntPtr thumb);
  [DllImport("dwmapi.dll")] public static extern int DwmUnregisterThumbnail(IntPtr thumb);
  [DllImport("dwmapi.dll")] public static extern int DwmUpdateThumbnailProperties(IntPtr thumb, ref THUMBPROP p);
  [StructLayout(LayoutKind.Sequential)]
  public struct THUMBPROP {
    public uint Flags; public RECT Dest; public RECT Src; public byte Opacity;
    public bool Visible; public bool SourceClientOnly;
  }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
[W32]::SetProcessDPIAware() | Out-Null
# keep the display awake for the duration of this invocation (captures come
# back black when the panel is asleep); ES_CONTINUOUS=0x80000000
[W32]::SetThreadExecutionState([uint32]2147483651) | Out-Null  # ES_CONTINUOUS|ES_SYSTEM_REQUIRED|ES_DISPLAY_REQUIRED

function Get-AppWindows([string]$name) {
  $pids = @{}
  Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object { $pids[[uint32]$_.Id] = $true }
  $found = New-Object System.Collections.ArrayList
  $cb = [W32+EnumProc]{ param($h, $lp)
    if ([W32]::IsWindowVisible($h)) {
      [uint32]$opid = 0
      [W32]::GetWindowThreadProcessId($h, [ref]$opid) | Out-Null
      if ($pids.ContainsKey($opid)) {
        $t = New-Object System.Text.StringBuilder 256
        [W32]::GetWindowText($h, $t, 256) | Out-Null
        $c = New-Object System.Text.StringBuilder 256
        [W32]::GetClassName($h, $c, 256) | Out-Null
        $r = New-Object W32+RECT
        [W32]::GetWindowRect($h, [ref]$r) | Out-Null
        $cr = New-Object W32+RECT
        [W32]::GetClientRect($h, [ref]$cr) | Out-Null
        if (($r.R - $r.L) -gt 150 -and ($r.B - $r.T) -gt 100) {
          [void]$found.Add([pscustomobject]@{
            Hwnd = $h; Pid = $opid; Title = $t.ToString(); Class = $c.ToString();
            X = $r.L; Y = $r.T; W = ($r.R - $r.L); H = ($r.B - $r.T);
            CW = $cr.R; CH = $cr.B })
        }
      }
    }
    return $true
  }
  [W32]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  return $found
}

function Save-Client([IntPtr]$h, [string]$file) {
  [W32]::ShowWindow($h, 9) | Out-Null          # SW_RESTORE if minimized
  [W32]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 500
  $cr = New-Object W32+RECT
  [W32]::GetClientRect($h, [ref]$cr) | Out-Null
  $wd = $cr.R; $ht = $cr.B
  $dir = Split-Path $file
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  # 1) PrintWindow with PW_RENDERFULLCONTENT: renders the DWM surface of the
  #    window itself, so off-screen/occluded windows still capture fully.
  $bmp = New-Object System.Drawing.Bitmap($wd, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [W32]::PrintWindow($h, $hdc, 2)
  $g.ReleaseHdc($hdc); $g.Dispose()
  $blank = $true
  $px = $bmp.GetPixel(10, 10)
  if ($px.A -ne 0) { $blank = $false }
  if (-not $ok -or $blank) {
    # 2) fallback: copy the on-screen region (needs the client fully visible)
    $pt = New-Object W32+POINT; $pt.X = 0; $pt.Y = 0
    [W32]::ClientToScreen($h, [ref]$pt) | Out-Null
    $g2 = [System.Drawing.Graphics]::FromImage($bmp)
    $g2.CopyFromScreen($pt.X, $pt.Y, 0, 0, (New-Object System.Drawing.Size($wd, $ht)))
    $g2.Dispose()
    Write-Host "printwindow failed -> screen copy"
  }
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("saved {0} ({1}x{2}, printwindow={3})" -f $file, $wd, $ht, $ok)
}

switch ($Cmd) {
  'list' {
    Get-AppWindows $Proc | Format-Table Hwnd, Pid, Title, Class, X, Y, W, H, CW, CH -AutoSize | Out-String -Width 200
  }
  'front' {
    [W32]::SetForegroundWindow([IntPtr]$Hwnd) | Out-Null
  }
  'resize' {
    # resize so that CLIENT area becomes W x H (input W/H = client target);
    # maximized windows ignore MoveWindow, so restore first.
    $h = [IntPtr]$Hwnd
    [W32]::ShowWindow($h, 9) | Out-Null   # SW_RESTORE
    Start-Sleep -Milliseconds 400
    $r = New-Object W32+RECT; [W32]::GetWindowRect($h, [ref]$r) | Out-Null
    $c = New-Object W32+RECT; [W32]::GetClientRect($h, [ref]$c) | Out-Null
    $dx = ($r.R - $r.L) - $c.R; $dy = ($r.B - $r.T) - $c.B
    $ok = [W32]::MoveWindow($h, 0, 0, $W + $dx, $H + $dy, $true)
    Write-Host ("MoveWindow: {0}" -f $ok)
    Start-Sleep -Milliseconds 700
    $c2 = New-Object W32+RECT; [W32]::GetClientRect($h, [ref]$c2) | Out-Null
    Write-Host ("client now {0}x{1}" -f $c2.R, $c2.B)
  }
  'click' {
    [W32]::SetCursorPos($X, $Y) | Out-Null
    Start-Sleep -Milliseconds 120
    [W32]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)   # LEFTDOWN
    [W32]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)   # LEFTUP
    Write-Host "clicked $X,$Y"
  }
  'key' {
    # combos: ctrl+K, win+shift+left/right (pull ghost-monitor windows back)
    $map = @{ k = 0x4B; p = 0x50; esc = 0x1B; enter = 0x0D; left = 0x25; right = 0x27; shift = 0x10; win = 0x5B }
    $parts = $Keys -split '\+'
    foreach ($p in $parts) { if ($map.ContainsKey($p)) { [W32]::keybd_event([byte]$map[$p], 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 } }
    Start-Sleep -Milliseconds 80
    foreach ($p in ($parts[($parts.Count - 1)..0])) { if ($map.ContainsKey($p)) { [W32]::keybd_event([byte]$map[$p], 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 } }
    Write-Host "sent $Keys"
  }
  'dwmshot' {
    # Render any window (even off-screen/occluded) through a DWM thumbnail
    # onto a temporary topmost form, then screen-copy that region.
    Add-Type -AssemblyName System.Windows.Forms
    $src = [IntPtr]$Hwnd
    $cr = New-Object W32+RECT; [W32]::GetClientRect($src, [ref]$cr) | Out-Null
    $wd = $cr.R; $ht = $cr.B
    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = 'None'; $form.TopMost = $true; $form.StartPosition = 'Manual'
    $form.Bounds = New-Object System.Drawing.Rectangle(0, 0, [Math]::Min($wd, 3840), [Math]::Min($ht, 2160))
    $form.ShowInTaskbar = $false
    $form.Show()
    $form.Focus() | Out-Null
    Start-Sleep -Milliseconds 300
    $thumb = [IntPtr]::Zero
    $hr = [W32]::DwmRegisterThumbnail($form.Handle, $src, [ref]$thumb)
    if ($hr -ne 0) { Write-Host ("DwmRegisterThumbnail failed hr=0x{0:X}" -f $hr); $form.Close(); break }
    $tp = New-Object W32+THUMBPROP
    $tp.Dest = New-Object W32+RECT; $tp.Dest.L = 0; $tp.Dest.T = 0; $tp.Dest.R = $form.Width; $tp.Dest.B = $form.Height
    $tp.Opacity = 255; $tp.Visible = $true; $tp.SourceClientOnly = $true
    $hr = [W32]::DwmUpdateThumbnailProperties($thumb, [ref]$tp)
    Start-Sleep -Milliseconds 700   # let DWM composite a fresh frame
    $bmp = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size($form.Width, $form.Height)))
    $g.Dispose()
    $dir = Split-Path $Out -Parent; $fname = Split-Path $Out -Leaf
    if (-not $fname -or $fname -notmatch '\.png$') { $fname = "$Prefix.png" } else { $fname = $fname }
    $full = if ($Out -match '\.png$') { $Out } else { Join-Path $Out ("{0}.png" -f $Prefix) }
    if (-not (Test-Path (Split-Path $full))) { New-Item -ItemType Directory -Path (Split-Path $full) -Force | Out-Null }
    $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    [W32]::DwmUnregisterThumbnail($thumb) | Out-Null
    $form.Close(); $form.Dispose()
    Write-Host ("saved {0} ({1}x{2})" -f $full, $form.Width, $form.Height)
  }
  'pclick' {
    # post a left click at CLIENT coords (X,Y) to the Chromium input child
    $h = [IntPtr]$Hwnd
    $targets = New-Object System.Collections.ArrayList
    $cb = [W32+EnumProc]{ param($c, $lp)
      $cn = New-Object System.Text.StringBuilder 256
      [W32]::GetClassName($c, $cn, 256) | Out-Null
      if ($cn.ToString() -match 'Chrome_RenderWidgetHostHWND') { [void]$targets.Add($c) }
      return $true
    }
    [W32]::EnumChildWindows($h, $cb, [IntPtr]::Zero) | Out-Null
    $t = if ($targets.Count -gt 0) { $targets[0] } else { $h }
    $l = [IntPtr](($Y -shl 16) -bor ($X -band 0xFFFF))
    $one = [UIntPtr]::new(1)
    [W32]::PostMessage($t, 0x0200, [UIntPtr]::Zero, $l) | Out-Null            # WM_MOUSEMOVE
    Start-Sleep -Milliseconds 80
    [W32]::PostMessage($t, 0x0201, $one, $l) | Out-Null                       # WM_LBUTTONDOWN
    Start-Sleep -Milliseconds 60
    [W32]::PostMessage($t, 0x0202, [UIntPtr]::Zero, $l) | Out-Null            # WM_LBUTTONUP
    Write-Host ("posted click {0},{1} -> hwnd {2} (children matched: {3})" -f $X, $Y, $t, $targets.Count)
  }
  'shot' {
    $wins = @(Get-AppWindows $Proc)
    Write-Host ("DBG cmd={0} proc={1} title={2} hwnd={3} matches={4}" -f $Cmd, $Proc, $Title, $Hwnd, $wins.Count)
    if ($Hwnd -ne 0) { $wins = @($wins | Where-Object { [int64]$_.Hwnd -eq $Hwnd }) }
    elseif ($Title -ne '') { $wins = @($wins | Where-Object { $_.Title -match $Title -or $_.Class -match $Title }) }
    elseif (-not $All) {
      $wins = @($wins | Sort-Object { -($_.CW * $_.CH) } | Select-Object -First 1)
    }
    foreach ($win in $wins) {
      $safe = if ($win.Title) { ($win.Title -replace '[\\/:*?"<>|]', '_') } else { 'untitled' }
      Save-Client $win.Hwnd (Join-Path $Out ("{0}-{1}-{2}.png" -f $Prefix, $win.Hwnd, $safe))
    }
  }
}
