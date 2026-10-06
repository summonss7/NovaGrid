@echo off
rem NovaGrid backup launcher -- all logic lives in backup.ps1
rem (pure ASCII on purpose: cmd mis-parses UTF-8 .bat files)
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup.ps1" %*
pause
