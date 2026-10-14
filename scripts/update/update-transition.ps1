# update-transition.ps1 (MyAgent F21)
# Lightweight WinForms transition window shown during a silent update.
# Spawned via the hidden update-transition.vbs relay before app.quit().
# Mechanism and close strategy adapted from WorkBuddy's
# resources/scripts/update-progress.ps1 (design/21-updater.md evidence):
#   1) The relaunched app process has a visible main window -> close.
#   2) The installer/update batch is gone AND a fade interval elapsed -> close.
#   3) -TimeoutSeconds without any installer observed -> defensive guard.
#   4) -MaxInstallSeconds absolute cap.
# Timeout must NOT close while files are still being swapped (WorkBuddy
# issue #135544 lesson: early close makes users launch mid-update).

param(
    [string]$InstallerPath = "",
    [string]$AppProcessName = "myagent",
    [int]$OldAppProcessId = 0,
    [string]$Title = "Installing Update",
    [string]$Message = "The update is almost done. The app will restart automatically...",
    [int]$TimeoutSeconds = 120,
    [int]$MaxInstallSeconds = 600,
    [int]$DetectStartSeconds = 3,
    [int]$FadeMs = 3000
)

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Test-NewAppWindowReady {
    if (-not $AppProcessName) { return $false }
    try {
        $ready = Get-Process -Name $AppProcessName -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -ne $OldAppProcessId -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Select-Object -First 1
        return ($null -ne $ready)
    } catch { return $false }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.ClientSize = New-Object System.Drawing.Size(420, 160)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "None"
$form.ControlBox = $false
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#2a3140")
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = $Message
$label.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#e8eaf0")
$label.AutoSize = $false
$label.Size = New-Object System.Drawing.Size(400, 140)
$label.Location = New-Object System.Drawing.Point(12, 12)
$form.Controls.Add($label)
$form.Show()

$start = Get-Date
$installerSeen = $false
$installerName = if ($InstallerPath) { [System.IO.Path]::GetFileNameWithoutExtension($InstallerPath) } else { "" }

while ($true) {
    Start-Sleep -Milliseconds 300
    $elapsed = ((Get-Date) - $start).TotalSeconds
    if (Test-NewAppWindowReady) { break }
    if ($installerName) {
        $p = Get-Process -Name $installerName -ErrorAction SilentlyContinue
        if ($p) { $installerSeen = $true }
        elseif ($installerSeen -and ($elapsed * 1000) -gt $FadeMs) { break }
    }
    if (-not $installerSeen -and $elapsed -gt $DetectStartSeconds) {
        # No installer to watch (portable-swap mode): rely on new-window probe
        # and the absolute cap only.
    }
    if ($elapsed -gt $MaxInstallSeconds) { break }
    if (-not $installerSeen -and $elapsed -gt $TimeoutSeconds) { break }
}
$form.Close()
$form.Dispose()
