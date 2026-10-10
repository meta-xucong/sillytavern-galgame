@echo off
for %%I in ("%~dp0..\..\..") do set "GALGAME_ROOT=%%~fI"
if /i not "%~1"=="--galgame-hidden-child" (
  wscript.exe //B //NoLogo "%GALGAME_ROOT%\external-modules\process-supervisor\run-hidden.vbs" "%~f0" --galgame-hidden-child %*
  exit /b 0
)
shift
setlocal
cd /d "%GALGAME_ROOT%"
node.exe "%GALGAME_ROOT%\server.js" --port 8001
exit /b %ERRORLEVEL%
