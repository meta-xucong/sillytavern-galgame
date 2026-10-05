@echo off
for %%I in ("%~dp0..\..\..") do set "GALGAME_ROOT=%%~fI"
if /i not "%~1"=="--galgame-hidden-child" (
  wscript.exe //B //NoLogo "%GALGAME_ROOT%\external-modules\process-supervisor\run-hidden.vbs" "%~f0" --galgame-hidden-child
  exit /b 0
)
shift
setlocal
cd /d "%GALGAME_ROOT%"
set "HOST=127.0.0.1"
set "PORT=8791"
set "SILLYTAVERN_BASE_URL=http://127.0.0.1:8001"
set "GALGAME_SILLYTAVERN_BASE_URL=http://127.0.0.1:8001"
for /f "delims=" %%H in ('powershell -NoProfile -Command "$env:COMPUTERNAME.ToLowerInvariant()"') do set "GALGAME_COMPUTERNAME_LOWER=%%H"
set "GALGAME_CORS_ORIGIN=http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8001,http://localhost:8001,http://%COMPUTERNAME%:8000,http://%COMPUTERNAME%:8001,http://%GALGAME_COMPUTERNAME_LOWER%:8000,http://%GALGAME_COMPUTERNAME_LOWER%:8001"
if not exist ".codex-longrun" mkdir ".codex-longrun"
set "SECRET_FILE=%CD%\.codex-longrun\galgame-bridge-proof-secret.txt"
if not exist "%SECRET_FILE%" (
  echo GALGAME_BRIDGE_PROOF_SECRET is missing; config service not started.
  exit /b 1
)
set "GALGAME_BRIDGE_PROOF_SECRET="
set /p GALGAME_BRIDGE_PROOF_SECRET=<"%SECRET_FILE%"
if not defined GALGAME_BRIDGE_PROOF_SECRET (
  echo GALGAME_BRIDGE_PROOF_SECRET is empty; config service not started.
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%GALGAME_ROOT%\external-modules\process-supervisor\StartGalgameHiddenNode.ps1" -Service configService
endlocal
