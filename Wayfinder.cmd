@echo off
setlocal
title Wayfinder RPG - SillyTavern 8001 + Companion 8002
if /I "%~1"=="status" (
    call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-local-sillytavern.ps1" -StatusOnly
) else (
    call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-local-sillytavern.ps1" %*
)
set "wayfinder_exit=%errorlevel%"
if not "%wayfinder_exit%"=="0" (
    echo.
    echo Wayfinder could not start the playable stack. The actionable error is above.
    if /I not "%~1"=="status" pause
)
endlocal & exit /b %wayfinder_exit%
