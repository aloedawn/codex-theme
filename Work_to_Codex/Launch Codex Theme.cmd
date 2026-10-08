@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch Codex Theme.ps1" %*
if errorlevel 1 pause
