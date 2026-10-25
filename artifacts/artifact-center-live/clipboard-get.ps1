
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Write-Output ([System.Windows.Forms.Clipboard]::GetText())