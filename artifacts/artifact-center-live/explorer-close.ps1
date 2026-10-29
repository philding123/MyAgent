
param([string]$Dir)
$shell=New-Object -ComObject Shell.Application
$n=0
foreach($w in @($shell.Windows())){
  try{
    $loc=[string]$w.LocationURL
    if(-not $loc.StartsWith('file:///')){ continue }
    $p=[uri]::UnescapeDataString($loc) -replace '^file:///',''
    $p=$p -replace '/','\'
    if($p -ieq $Dir){ $w.Quit(); $n++ }
  }catch{}
}
Start-Sleep -Milliseconds 500
Write-Output $n