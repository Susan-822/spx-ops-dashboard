@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "ENV_FILE=%USERPROFILE%\Downloads\bridge\.env"
if not exist "%ENV_FILE%" set "ENV_FILE=%~dp0.env"

echo [INFO] env_file_candidate=%ENV_FILE%

where java >nul 2>nul
if errorlevel 1 (
  echo [FAIL] Java status: NOT FOUND
) else (
  echo [OK] Java status: FOUND
)

netstat -ano | findstr ":25503" >nul
if errorlevel 1 (
  echo [WARN] Theta port 25503 status: NOT LISTENING
) else (
  echo [OK] Theta port 25503 status: LISTENING
)

if not exist "%ENV_FILE%" (
  echo [WARN] env file not found: %ENV_FILE%
) else (
  for /f "tokens=1,* delims==" %%A in ('type "%ENV_FILE%" ^| findstr /r "^[A-Za-z_][A-Za-z0-9_]*="') do (
    set "%%A=%%B"
  )
)

if defined CLOUD_URL (echo [OK] CLOUD_URL configured: true) else (echo [FAIL] CLOUD_URL configured: false)
if defined DATA_PUSH_API_KEY (echo [OK] DATA_PUSH_API_KEY configured: true) else (echo [FAIL] DATA_PUSH_API_KEY configured: false)

node scripts\theta-local-check.mjs
if errorlevel 1 (
  echo [FAIL] theta-local-check failed
) else (
  echo [OK] theta-local-check completed
)

if not defined CLOUD_URL goto :afterCloud
if not defined DATA_PUSH_API_KEY goto :afterCloud

echo [INFO] Running theta-only cloud push check...
node scripts\spx-bridge.mjs --theta-only --once
if errorlevel 1 (
  echo [FAIL] theta-only --once failed
) else (
  echo [OK] theta-only --once completed
)

echo [INFO] Checking /signals/current...
node -e "const base=(process.env.CLOUD_URL||'').replace(/\/$/,''); if(!base){process.exit(0)} fetch(base+'/signals/current').then(r=>r.json()).then(j=>{const ok=Boolean(j.theta)&&Boolean(j.dealer_conclusion)&&Boolean(j.execution_constraints)&&Boolean(j.command_inputs)&&Boolean(j.projection); console.log(JSON.stringify({signals_current_ok:ok, theta:j.theta?.status, dealer_status:j.dealer_conclusion?.status},null,2)); process.exit(ok?0:1);}).catch(err=>{console.error(err.message); process.exit(1);});"
if errorlevel 1 (
  echo [FAIL] /signals/current check failed
) else (
  echo [OK] /signals/current contains theta/dealer_conclusion
)

:afterCloud
echo [DONE] Check-SPX-Ops completed.
endlocal
