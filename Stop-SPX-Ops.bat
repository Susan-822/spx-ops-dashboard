@echo off
setlocal

echo [Stop-SPX-Ops] Stopping local bridge...
for /f "tokens=2 delims=," %%P in ('wmic process where "CommandLine like '%%spx-bridge.mjs%%'" get ProcessId /format:csv ^| findstr /R "[0-9]"') do (
  taskkill /PID %%P /F >nul 2>&1
  echo Stopped bridge PID %%P
)

echo [Stop-SPX-Ops] Stop Theta Java? Pass /theta to stop java too.
if /I "%1"=="/theta" (
  for /f "tokens=2 delims=," %%P in ('wmic process where "CommandLine like '%%ThetaTerminalv3.jar%%'" get ProcessId /format:csv ^| findstr /R "[0-9]"') do (
    taskkill /PID %%P /F >nul 2>&1
    echo Stopped Theta PID %%P
  )
)

echo [Stop-SPX-Ops] Done.
endlocal
