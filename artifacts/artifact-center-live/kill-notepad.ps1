
param([string]$Match)
Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like ('*'+$Match+'*') } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output 'OK'