@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0control_panel.ps1" %*
exit /b %ERRORLEVEL%
