@echo off
setlocal
title Wayfinder RPG - SillyTavern 8001 + Companion 8002
call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\wayfinder.ps1" %*
set "wayfinder_exit=%errorlevel%"
if not "%wayfinder_exit%"=="0" (
    echo.
    echo Wayfinder could not start the playable stack or complete the requested command. The actionable error is above.
    if "%~1"=="" pause
    if /I "%~1"=="start" pause
)
endlocal & exit /b %wayfinder_exit%
