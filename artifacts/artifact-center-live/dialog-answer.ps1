
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
Write-Output ('BUTTON_NOT_FOUND ' + $result); exit 4