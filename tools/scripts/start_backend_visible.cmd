@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_backend_visible.ps1" %*
exit /b %ERRORLEVEL%
