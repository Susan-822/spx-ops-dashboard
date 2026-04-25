@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "TASK_NAME=SPX-Ops-Theta-Bridge"
set "START_SCRIPT=%~dp0Start-SPX-Ops.bat"

if not exist "%START_SCRIPT%" (
  echo [ERROR] Start-SPX-Ops.bat not found at %START_SCRIPT%
  exit /b 1
)

schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>nul
schtasks /Create /SC ONLOGON /RL HIGHEST /TN "%TASK_NAME%" /TR "\"%START_SCRIPT%\"" /F
if errorlevel 1 (
  echo [ERROR] Failed to create Task Scheduler entry.
  exit /b 1
)

echo [OK] Task Scheduler startup installed.
echo      Task name: %TASK_NAME%
echo      Target: %START_SCRIPT%
exit /b 0
