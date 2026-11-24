@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Tsugi.ps1"
if errorlevel 1 (
  echo Tsugi setup did not complete. See the error above.
  pause
)
