@echo off
for %%I in ("%~dp0..\..\..") do set "GALGAME_ROOT=%%~fI"
if /i not "%~1"=="--galgame-hidden-child" (
  wscript.exe //B //NoLogo "%GALGAME_ROOT%\external-modules\process-supervisor\run-hidden.vbs" "%~f0" --galgame-hidden-child
  exit /b 0
)
shift
cd /d "%GALGAME_ROOT%"
call "%~dp0StartGalgameConfigService.cmd" || exit /b 1
call "%~dp0StartGalgameRuntimeBridge.cmd" || exit /b 1
call "%~dp0StartGalgameVisualAssetService.cmd"
call "%GALGAME_ROOT%\external-modules\presentation-analysis-service\StartGalgamePresentationAnalysisService.cmd"
if errorlevel 1 echo WARNING: presentation analysis is unavailable; character and scene annotations will remain neutral until the analyzer is configured.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0VerifyGalgameServices.ps1"
exit /b %ERRORLEVEL%
