@echo off
setlocal
cd /d "%~dp0"
if defined GALGAME_VISUAL_PROVIDER_ENV_FILE if exist "%GALGAME_VISUAL_PROVIDER_ENV_FILE%" goto start_controlled_visual_service
if exist "D:\AI\alchemy_video_OS\.env.local" goto start_controlled_visual_service
goto start_legacy_visual_service

:start_controlled_visual_service
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0StartGalgameVisualAnalyzerTest.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:start_legacy_visual_service
set "GALGAME_VISUAL_ASSET_HOST=127.0.0.1"
set "GALGAME_VISUAL_ASSET_PORT=8798"
set "GALGAME_VISUAL_ASSET_ADMIN_TOKEN="
set "GALGAME_VISUAL_ASSET_ADMIN_ORIGINS="
for /f "delims=" %%H in ('powershell -NoProfile -Command "$env:COMPUTERNAME.ToLowerInvariant()"') do set "GALGAME_COMPUTERNAME_LOWER=%%H"
set "GALGAME_VISUAL_CORE_PLAYER_ORIGINS=http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8001,http://localhost:8001,http://%COMPUTERNAME%:8000,http://%COMPUTERNAME%:8001,http://%GALGAME_COMPUTERNAME_LOWER%:8000,http://%GALGAME_COMPUTERNAME_LOWER%:8001"
set "GALGAME_VISUAL_ANALYZER_TOKEN="
set "GALGAME_VISUAL_RUNTIME_TOKEN="
set "GALGAME_VISUAL_ASSET_DATA_DIR=%CD%\external-modules\visual-asset-service\data"
if not exist ".codex-longrun" mkdir ".codex-longrun"
if not exist "%GALGAME_VISUAL_ASSET_DATA_DIR%" mkdir "%GALGAME_VISUAL_ASSET_DATA_DIR%"
set "OUT_LOG=%CD%\.codex-longrun\visual-asset-service.out.log"
set "ERR_LOG=%CD%\.codex-longrun\visual-asset-service.err.log"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'node*' -and $_.CommandLine -like '*external-modules/visual-asset-service/server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
>>"%OUT_LOG%" echo [%date% %time%] starting loopback visual-asset-service on http://127.0.0.1:8798
start "" /min cmd /d /c "node external-modules/visual-asset-service/server.mjs 1>>.codex-longrun\visual-asset-service.out.log 2>>.codex-longrun\visual-asset-service.err.log"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$uri='http://127.0.0.1:8798/v1/health'; $healthy=$false; foreach ($attempt in 1..10) { try { $response=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri $uri; $body=$response.Content | ConvertFrom-Json; if ($response.StatusCode -eq 200 -and $body.ok -eq $true) { $healthy=$true; break } } catch { }; Start-Sleep -Milliseconds 200 }; if ($healthy) { Write-Host 'visual-asset-service healthy at http://127.0.0.1:8798/game-admin/' } else { Write-Warning 'visual-asset-service did not become healthy; no visual upload is available. Inspect .codex-longrun\visual-asset-service.err.log'; exit 1 }"
if errorlevel 1 (
  echo WARNING: visual-asset-service startup failed; no visual upload is available. Check .codex-longrun\visual-asset-service.err.log
  endlocal
  exit /b 1
)
endlocal
exit /b 0
