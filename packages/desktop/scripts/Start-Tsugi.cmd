@echo off
setlocal
if /I "%~1"=="-PrepareOnly" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Tsugi.ps1" -PrepareOnly
  if errorlevel 1 exit /b 1
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Tsugi.ps1"
if errorlevel 1 (
  echo Tsugi setup did not complete. See the error above.
  pause
  exit /b 1
)
exit /b 0
