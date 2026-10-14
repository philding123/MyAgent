' update-transition.vbs (MyAgent F21)
' Hidden relay: launches the PowerShell transition window without a console
' flash. Mechanism copied from WorkBuddy launch-update-progress.vbs evidence:
' cmd /c start flashes conhost; detached powershell exits early; wscript is a
' GUI-subsystem host and WshShell.Run(cmd, 0, False) keeps PowerShell alive
' after the Electron main process quits.
'
' Usage: wscript.exe update-transition.vbs <ps1Path> [powershell args...]

Option Explicit

Dim shell, args, i, ps1Path, forwarded, cmd

If WScript.Arguments.Count < 1 Then WScript.Quit 0

Set shell = CreateObject("WScript.Shell")
Set args = WScript.Arguments
ps1Path = args(0)

forwarded = ""
For i = 1 To args.Count - 1
    forwarded = forwarded & " " & Quote(args(i))
Next

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " _
    & Quote(ps1Path) & forwarded

shell.Run cmd, 0, False
WScript.Quit 0

Function Quote(value)
    Quote = """" & Replace(value, """", """""") & """"
End Function
