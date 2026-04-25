@echo off
setlocal
cd /d "%~dp0"

set "ENV_FILE=C:\Users\susan\Downloads\bridge\.env"
if not exist "%ENV_FILE%" set "ENV_FILE=%~dp0.env"

echo [Check-SPX-Ops] env_file_used=%ENV_FILE%
node "%~dp0scripts\theta-local-check.mjs"
if errorlevel 1 (
  echo [Check-SPX-Ops] theta-local-check failed.
  exit /b 1
)

if exist "%~dp0scripts\spx-bridge.mjs" (
  node "%~dp0scripts\spx-bridge.mjs" --theta-only --once
  exit /b %errorlevel%
)

echo [Check-SPX-Ops] missing scripts\spx-bridge.mjs
exit /b 1
