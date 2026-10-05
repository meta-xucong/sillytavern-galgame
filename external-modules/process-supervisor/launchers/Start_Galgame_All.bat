@echo off
for %%I in ("%~dp0..\..\..") do set "GALGAME_ROOT=%%~fI"
if /i not "%~1"=="--galgame-hidden-child" (
  wscript.exe //B //NoLogo "%GALGAME_ROOT%\external-modules\process-supervisor\run-hidden.vbs" "%~f0" --galgame-hidden-child %*
  exit /b 0
)
shift
cd /d "%GALGAME_ROOT%"
if not exist ".codex-longrun" mkdir ".codex-longrun"
set "LOG=%CD%\.codex-longrun\start-galgame-all.log"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start_Galgame_All.ps1" %* 1>>"%LOG%" 2>>&1
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo Start_Galgame_All failed with exit code %EXIT_CODE%. See %LOG%.>>"%LOG%"
exit /b %EXIT_CODE%
