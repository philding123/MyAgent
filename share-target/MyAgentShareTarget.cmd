@echo off
rem MyAgentShareTarget.cmd (F24): the sparse-package share activation entry.
rem Windows invokes this with the shared file path(s); forward the first to
rem the main app and exit (personal-use simplification of WorkBuddy's
rem standalone helper exe - functionally equivalent: file reaches the app).
setlocal
set "FIRSTFILE=%~1"
if "%FIRSTFILE%"=="" exit /b 0
set "APPDIR=%~dp0..\"
start "" "%APPDIR%MyAgent.exe" --share "%FIRSTFILE%"
exit /b 0
