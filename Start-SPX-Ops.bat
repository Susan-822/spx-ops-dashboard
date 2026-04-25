@echo off
setlocal EnableDelayedExpansion
set "ROOT=%~dp0"
set "ENV_PRIMARY=C:\Users\susan\Downloads\bridge\.env"
set "ENV_FALLBACK=%ROOT%.env"
set "THETA_JAR=%ROOT%ThetaTerminalv3.jar"

where java >nul 2>nul
if errorlevel 1 (
  echo ERROR: Java not installed
  exit /b 1
)

if not exist "%THETA_JAR%" (
  echo ERROR: Theta jar missing - "%THETA_JAR%"
  exit /b 1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":25503"') do (
  taskkill /PID %%P /F >nul 2>nul
)

if exist "%ENV_PRIMARY%" (
  set "ENV_FILE=%ENV_PRIMARY%"
) else (
  set "ENV_FILE=%ENV_FALLBACK%"
)

echo Using env file: %ENV_FILE%
echo Starting Theta Terminal...
start "ThetaTerminal" cmd /c "java -jar "%THETA_JAR%""

echo Waiting for Theta port 25503...
set "READY="
for /L %%I in (1,1,30) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:25503/v3/option/list/expirations?symbol=SPXW&format=json' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 (
    set "READY=1"
    goto :theta_ready
  )
  timeout /t 2 >nul
)

:theta_ready
if not defined READY (
  echo ERROR: Theta not reachable on 25503
  exit /b 1
)

echo Theta reachable. Starting bridge...
start "SPX-Bridge" cmd /c "node "%ROOT%scripts\spx-bridge.mjs" --theta-only"
echo STARTED: Theta Terminal + theta-only bridge
exit /b 0
