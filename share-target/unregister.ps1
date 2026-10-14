# unregister.ps1 — MyAgent share-target sparse package removal (F24).
# Best-effort, adapted from WorkBuddy share-target/scripts/unregister.ps1:
# if blocked, the package lingers as an orphan record with no active side
# effect; manual cleanup: Remove-AppxPackage MyAgentShare.
# Exit codes: 0 removed or not registered; 1 threw / timed out / still visible.

$ErrorActionPreference = 'Continue'
$diagLog = Join-Path $env:TEMP 'myagent-unregister.log'
function Log([string]$m) { try { Add-Content -Path $diagLog -Value ((Get-Date).ToString('s') + ' ' + $m) } catch {} }

Log '=== myagent unregister start ==='
$pkg = Get-AppxPackage -Name 'MyAgentShare' -ErrorAction SilentlyContinue
if (-not $pkg) { Log 'not registered; nothing to do'; exit 0 }
try {
    $job = Start-Job -ScriptBlock { param($n) try { Remove-AppxPackage -Package $n -ErrorAction Stop; 'RM_OK' } catch { 'RM_ERR ' + $_.Exception.Message } } -ArgumentList $pkg.PackageFullName
    $finished = Wait-Job $job -Timeout 60
    if (-not $finished) { Stop-Job $job; Remove-Job $job -Force; Log 'Remove-AppxPackage timed out'; exit 1 }
    $out = (Receive-Job $job 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
    Remove-Job $job -Force
    Log ('remove result: ' + $out)
    if (Get-AppxPackage -Name 'MyAgentShare' -ErrorAction SilentlyContinue) { Log 'still visible after remove'; exit 1 }
    exit 0
} catch {
    Log ('EXCEPTION ' + $_.Exception.Message)
    exit 1
}
