@echo off
cd /d "%~dp0"
call StartGalgameConfigService.cmd
call StartGalgameRuntimeBridge.cmd
