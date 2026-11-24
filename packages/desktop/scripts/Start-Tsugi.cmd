@echo off
setlocal
rem Use Windows PowerShell's own system modules, not PowerShell 7's inherited path.
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
if /I "%~1"=="-PrepareOnly" (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Tsugi.ps1" -PrepareOnly
  if errorlevel 1 exit /b 1
  exit /b 0
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Tsugi.ps1"
if errorlevel 1 (
  echo Tsugi setup did not complete. See the error above.
  pause
  exit /b 1
)
exit /b 0
