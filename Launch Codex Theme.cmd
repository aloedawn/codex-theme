@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Work_to_Codex\Launch Codex Theme.ps1" %*
if errorlevel 1 pause
