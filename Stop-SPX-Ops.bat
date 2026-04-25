@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo [SPX-OPS] Stopping local bridge...
for /f "tokens=2 delims=," %%P in ('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH ^| findstr /I "node.exe"') do (
  set PID=%%~P
  wmic process where "ProcessId=!PID!" get CommandLine /value 2>nul | findstr /I "scripts\\spx-bridge.mjs scripts\\theta-bridge.mjs" >nul
  if not errorlevel 1 (
    echo [SPX-OPS] stopping node pid !PID!
    taskkill /PID !PID! /F >nul 2>&1
  )
)

set /p STOP_THETA=Stop ThetaTerminal Java too? [y/N]:
if /I "%STOP_THETA%"=="Y" (
  echo [SPX-OPS] stopping Java processes containing ThetaTerminalv3.jar...
  for /f "tokens=2 delims=," %%P in ('tasklist /FI "IMAGENAME eq java.exe" /FO CSV /NH ^| findstr /I "java.exe"') do (
    set JPID=%%~P
    wmic process where "ProcessId=!JPID!" get CommandLine /value 2>nul | findstr /I "ThetaTerminalv3.jar" >nul
    if not errorlevel 1 (
      echo [SPX-OPS] stopping java pid !JPID!
      taskkill /PID !JPID! /F >nul 2>&1
    )
  )
)

echo [SPX-OPS] Done.
exit /b 0
