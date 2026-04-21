@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync_st_extension.ps1" %*
exit /b %ERRORLEVEL%
