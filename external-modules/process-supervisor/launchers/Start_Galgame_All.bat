@echo off
setlocal
set "GALGAME_LAUNCHER_DIR=%~dp0"
for %%I in ("%~dp0..\..\..") do set "GALGAME_ROOT=%%~fI"
if /i "%~1"=="--galgame-hidden-child" goto hidden_child
set "START_ARGS="
if /i "%~1"=="-NoBrowser" set "START_ARGS=-NoBrowser"
if not "%~1"=="" if /i not "%~1"=="-NoBrowser" goto invalid_argument
wscript.exe //B //NoLogo "%GALGAME_ROOT%\external-modules\process-supervisor\run-hidden.vbs" "%~f0" --galgame-hidden-child %START_ARGS%
exit /b 0

:invalid_argument
echo Unsupported argument: %~1
exit /b 2

:hidden_child
shift
cd /d "%GALGAME_ROOT%"
if not exist ".codex-longrun" mkdir ".codex-longrun"
set "LOG=%CD%\.codex-longrun\start-galgame-all.log"
set "NO_BROWSER_ARG="
if /i "%~1"=="-NoBrowser" set "NO_BROWSER_ARG=-NoBrowser"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%GALGAME_LAUNCHER_DIR%Start_Galgame_All.ps1" %NO_BROWSER_ARG% 1>>"%LOG%" 2>>&1
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo Start_Galgame_All failed with exit code %EXIT_CODE%. See %LOG%.>>"%LOG%"
  powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ws=New-Object -ComObject WScript.Shell; [void]$ws.Popup('Startup did not complete. See the log at: %LOG%',0,'Galgame startup failed',16)" 1>nul 2>nul
)
exit /b %EXIT_CODE%
