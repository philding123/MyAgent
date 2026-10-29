
param([string]$FilePath,[string]$ArgumentList)
Start-Process -FilePath $FilePath -ArgumentList $ArgumentList
Write-Output 'STARTED'