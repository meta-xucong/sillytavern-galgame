@echo off
setlocal
cd /d "%~dp0"
set "HOST=127.0.0.1"
set "PORT=8795"
set "SILLYTAVERN_BASE_URL=http://127.0.0.1:8000"
set "GALGAME_ALLOWED_ORIGINS=http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8001,http://localhost:8001"
if not exist ".codex-longrun" mkdir ".codex-longrun"
set "SECRET_FILE=%CD%\.codex-longrun\galgame-bridge-proof-secret.txt"
if not exist "%SECRET_FILE%" powershell -NoProfile -ExecutionPolicy Bypass -Command "[guid]::NewGuid().ToString('N') | Set-Content -NoNewline -Encoding ASCII -LiteralPath '%SECRET_FILE%'"
set /p GALGAME_BRIDGE_PROOF_SECRET=<"%SECRET_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'node*' -and $_.CommandLine -like '*external-modules/original-runtime-bridge/server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
start "" /min cmd /c "node external-modules/original-runtime-bridge/server.mjs > .codex-longrun\original-runtime-bridge.out.log 2> .codex-longrun\original-runtime-bridge.err.log"
endlocal
