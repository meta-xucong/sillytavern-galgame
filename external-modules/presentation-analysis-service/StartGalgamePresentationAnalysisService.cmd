@echo off
if /i not "%~1"=="--galgame-hidden-child" (
  wscript.exe //B //NoLogo "%~dp0..\process-supervisor\run-hidden.vbs" "%~f0" --galgame-hidden-child
  exit /b 0
)
shift
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0StartGalgamePresentationAnalysisService.ps1"
exit /b %ERRORLEVEL%
