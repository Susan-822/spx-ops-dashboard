@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "BRIDGE_DIR=%USERPROFILE%\Downloads\bridge"
set "ENV_FILE=%BRIDGE_DIR%\.env"
set "THETA_JAR_DOWNLOADS=%USERPROFILE%\Downloads\ThetaTerminalv3.jar"
set "THETA_JAR_LOCAL=%CD%\ThetaTerminalv3.jar"
set "THETA_JAR="

echo [SPX OPS] Starting local ThetaData + Bridge stack...

where java >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Java not found. Install Java and retry.
  exit /b 1
)
echo [OK] Java found.

if exist "%THETA_JAR_LOCAL%" set "THETA_JAR=%THETA_JAR_LOCAL%"
if not defined THETA_JAR if exist "%THETA_JAR_DOWNLOADS%" set "THETA_JAR=%THETA_JAR_DOWNLOADS%"
if not defined THETA_JAR (
  echo [ERROR] ThetaTerminalv3.jar not found.
  echo         Expected one of:
  echo         - %THETA_JAR_LOCAL%
  echo         - %THETA_JAR_DOWNLOADS%
  exit /b 1
)
echo [OK] Theta jar: %THETA_JAR%

if exist "%ENV_FILE%" (
  echo [INFO] Using env file: %ENV_FILE%
) else (
  echo [WARN] bridge\.env not found at %ENV_FILE%
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":25503"') do (
  if not "%%P"=="" (
    echo [INFO] Releasing old process on 25503: PID %%P
    taskkill /PID %%P /F >nul 2>nul
  )
)

echo [STEP] Launching Theta Terminal...
start "ThetaTerminal" cmd /c "cd /d "%~dp0" && java -jar "%THETA_JAR%""

echo [STEP] Waiting for http://127.0.0.1:25503 ...
set "THETA_READY="
for /L %%I in (1,1,40) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:25503 -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 (
    set "THETA_READY=1"
    goto :theta_ready
  )
  timeout /t 1 >nul
)

:theta_ready
if not defined THETA_READY (
  echo [ERROR] Theta Terminal did not become reachable on 25503.
  echo         Possible causes: Theta not logged in, jar startup failed, or port still occupied.
  exit /b 1
)
echo [OK] Theta port 25503 reachable.

echo [STEP] Starting theta-only bridge...
start "SPX-Theta-Bridge" cmd /c "cd /d "%~dp0" && node scripts\spx-bridge.mjs --theta-only"

echo [DONE] SPX Ops local stack started.
echo        - Theta Terminal: running
echo        - Theta-only bridge: running
echo        - Next: open Dashboard and verify /signals/current
exit /b 0
