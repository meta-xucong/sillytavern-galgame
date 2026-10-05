@echo off
for %%I in ("%~dp0..\..\..") do set "GALGAME_ROOT=%%~fI"
if /i "%~1"=="--galgame-hidden-child" goto hidden_child
if defined GALGAME_VISUAL_PROVIDER_ENV_FILE if exist "%GALGAME_VISUAL_PROVIDER_ENV_FILE%" goto launch_hidden
if exist "%GALGAME_ROOT%\.env.local" goto launch_hidden
goto launch_visible
:launch_hidden
wscript.exe //B //NoLogo "%GALGAME_ROOT%\external-modules\process-supervisor\run-hidden.vbs" "%~f0" --galgame-hidden-child
exit /b 0
:hidden_child
shift
:launch_visible
setlocal
cd /d "%GALGAME_ROOT%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0StartGalgameVisualAnalyzerTest.ps1" -OpenAdmin
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
