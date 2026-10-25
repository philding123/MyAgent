
param([string]$Needle)
# One "pid|name" line per process whose command line mentions the needle.
# Exclude this probe itself: its own command line carries the needle as an arg.
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Get-CimInstance Win32_Process -Filter "CommandLine IS NOT NULL" |
  Where-Object { $_.CommandLine -like ('*'+$Needle+'*') -and $_.CommandLine -notlike '*procs-with.ps1*' } |
  ForEach-Object { Write-Output ($_.ProcessId.ToString()+'|'+$_.Name) }