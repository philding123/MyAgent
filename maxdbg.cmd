@echo off
cd /d D:\Proj\ai_workspace\myagent
set MYAGENT_HOME=%TEMP%\myagent-maxdbg
node node_modules\electron\cli.js . --remote-debugging-port=9225
