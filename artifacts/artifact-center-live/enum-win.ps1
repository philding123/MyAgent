param([int]$ProcId)
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WEnum {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public static List<string> Go(int want) {
    var list = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == want) {
        var t = new StringBuilder(256); GetWindowText(h, t, 256);
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        var owner = GetWindow(h, 4 /* GW_HWNDOWNER */);
        list.Add(String.Format("{0}|cls={1}|vis={2}|owner={3}", t, c, IsWindowVisible(h), owner));
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
[WEnum]::Go($ProcId) | ForEach-Object { Write-Output $_ }
