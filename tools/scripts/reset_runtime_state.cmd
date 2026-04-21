@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset_runtime_state.ps1" %*
exit /b %ERRORLEVEL%
