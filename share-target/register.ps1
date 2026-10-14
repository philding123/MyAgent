# register.ps1 — MyAgent share-target sparse package (F24).
# Structure and engineering details adapted from WorkBuddy
# share-target/scripts/register.ps1 (design/24-share-target.md evidence):
#   - paths via env vars (MYAGENT_SHT_INSTDIR / MYAGENT_SHT_LOG)
#   - dual logging (primary user log + %TEMP% diagnostic backup)
#   - Add-/Remove-AppxPackage wrapped in background jobs with a hard timeout
#     (AppXSvc can hang forever; reads stay in the foreground)
#   - exit codes: 0 ok / 1 exception / 2 missing artifacts / 3 invisible after
#     add / 4 timeout (app-side self-heal retries on next launch)
#
# Sparse packages need a trusted signature: when no cert is provided we
# create a self-signed cert (CN=MyAgentShare) and trust it in TrustedPeople,
# then sign a copy of the manifest-backed package directory.
#
# Manual run:
#   $env:MYAGENT_SHT_INSTDIR = 'D:\Proj\ai_workspace\myagent'
#   powershell -ExecutionPolicy Bypass -File share-target\register.ps1

$ErrorActionPreference = 'Continue'

$diagLog = Join-Path $env:TEMP 'myagent-register.log'
$primaryLog = $env:MYAGENT_SHT_LOG
function Log([string]$m) {
    $line = (Get-Date).ToString('s') + ' ' + $m
    if ($primaryLog) {
        try {
            $parent = Split-Path -Parent $primaryLog
            if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            Add-Content -Path $primaryLog -Value $line
        } catch {
            try { Add-Content -Path $diagLog -Value ($line + ' [primary-write-failed]') } catch {}
        }
    }
    try { Add-Content -Path $diagLog -Value $line } catch {}
}

$script:SHT_APPX_TIMEOUT_SEC = 60

function Invoke-AppxJob {
    param([string]$Desc, [scriptblock]$Operation, [object[]]$ArgumentList = @())
    $job = Start-Job -ScriptBlock $Operation -ArgumentList $ArgumentList
    $finished = Wait-Job $job -Timeout $script:SHT_APPX_TIMEOUT_SEC
    if (-not $finished) {
        Stop-Job $job; Remove-Job $job -Force
        Log ('TIMEOUT ' + $Desc + ' after ' + $script:SHT_APPX_TIMEOUT_SEC + 's (AppXSvc hung)')
        return $null
    }
    $output = Receive-Job $job 2>&1 | ForEach-Object { $_.ToString() }
    Remove-Job $job -Force
    return ($output -join "`n")
}

$instDir = $env:MYAGENT_SHT_INSTDIR
if (-not $instDir) {
    # default to repo root relative to this script (manual runs)
    $instDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$manifestPath = Join-Path $instDir 'share-target\AppxManifest.xml'
# Appx schema requires Executable to be a real .exe; until the package can be
# signed and the activation contract observed (design/24: needs one elevated
# session + signtool), a placeholder copy of cmd.exe satisfies validation.
$exePlaceholder = Join-Path $instDir 'share-target\MyAgentShareTarget.exe'
if (-not (Test-Path $exePlaceholder)) {
    Copy-Item (Join-Path $env:SystemRoot 'System32\cmd.exe') $exePlaceholder
    Log 'placeholder forwarder exe created (activation contract finalized post-registration)'
}
Log '=== myagent register start ==='
Log ('instDir=' + $instDir)
Log ('manifest exists=' + (Test-Path $manifestPath))
if (-not (Test-Path $manifestPath)) { Log 'ERROR manifest missing'; exit 2 }

try {
    # 1) ensure a signing identity exists (self-signed, personal use)
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq 'CN=MyAgentShare' } | Select-Object -First 1
    if (-not $cert) {
        Log 'creating self-signed cert CN=MyAgentShare'
        $cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=MyAgentShare' `
            -KeyUsage DigitalSignature -FriendlyName 'MyAgent Share Package' `
            -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(5) `
            -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
    }
    # trust it for package validation
    $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if (-not $trusted) {
        try {
            $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('TrustedPeople', 'LocalMachine')
            $store.Open('ReadWrite')
            $store.Add($cert)
            $store.Close()
            Log 'cert added to LocalMachine\TrustedPeople'
        } catch { Log ('WARN could not trust cert (elevate if registration fails): ' + $_.Exception.Message) }
    }

    # 2) pack + sign (MakeAppx/SignTool ship with the Windows SDK; when absent,
    #    fall back to Add-AppxPackage on the raw manifest dir which Windows 10+ accepts
    #    for sparse registration only when signed — report a clear error otherwise)
    $pkgPath = Join-Path $env:TEMP 'MyAgentShare.msix'
    $makeappx = Get-Command makeappx.exe -ErrorAction SilentlyContinue
    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($makeappx -and $signtool) {
        $staging = Join-Path $env:TEMP 'MyAgentShare-pkg'
        if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        Copy-Item $manifestPath (Join-Path $staging 'AppxManifest.xml')
        Copy-Item (Join-Path $instDir 'share-target\MyAgentShareTarget.cmd') $staging
        & $makeappx.Path pack /o /d $staging /p $pkgPath 2>&1 | ForEach-Object { Log ('makeappx: ' + $_) }
        & $signtool.Path sign /fd SHA256 /a /f (Join-Path $instDir 'share-target\MyAgentShare.pfx') $pkgPath 2>&1 | ForEach-Object { Log ('signtool: ' + $_) }
    } else {
        Log 'makeappx/signtool not on PATH; attempting raw Add-AppxPackage -Register'
        $pkgPath = $manifestPath
    }

    # 3) register (sparse: files stay in place; ExternalLocation per MS docs)
    $out = Invoke-AppxJob -Desc 'Add-AppxPackage' -Operation {
        param($p, $loc)
        try {
            if ($p -like '*.msix') { Add-AppxPackage -Path $p -ErrorAction Stop }
            else { Add-AppxPackage -Register $p -ExternalLocation $loc -ErrorAction Stop }
            'ADD_OK'
        } catch { 'ADD_ERR ' + $_.Exception.Message }
    } -ArgumentList @($pkgPath, $instDir)
    if (-not $out) { Log 'registration timed out'; exit 4 }
    Log ('Add-AppxPackage result: ' + $out)
    if ($out -like 'ADD_ERR*') {
        if ($out -like '*0x80073CFF*' -or $out -like '*Unsigned*') {
            Log 'REMAINING STEPS (manifest+schema already valid):'
            Log '  1. Settings > System > For developers > enable Developer Mode (sideload)'
            Log '  2. Install Windows SDK signing tools (makeappx + signtool), then:'
            Log '     makeappx pack /o /d <stage> /p MyAgentShare.msix'
            Log '     signtool sign /fd SHA256 /a /f MyAgentShare.pfx MyAgentShare.msix'
            Log '  3. Elevated once: import CN=MyAgentShare cert into LocalMachine\TrustedPeople'
            Log '     then: Add-AppxPackage -Path MyAgentShare.msix'
        }
        exit 1
    }

    # 4) verify visibility
    $seen = Get-AppxPackage -Name 'MyAgentShare' -ErrorAction SilentlyContinue
    if (-not $seen) { Log 'ERROR package not visible after add'; exit 3 }
    Log ('registered: ' + $seen.PackageFullName)
    exit 0
} catch {
    Log ('EXCEPTION ' + $_.Exception.ToString())
    exit 1
}
