
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
$hits | ForEach-Object { Write-Output $_ }