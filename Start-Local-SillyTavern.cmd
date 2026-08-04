@echo off
setlocal
title SillyTavern RPG - localhost 8001
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-local-sillytavern.ps1"
if errorlevel 1 (
    echo.
    echo SillyTavern did not start. This window is staying open so the error remains visible.
    pause
)
endlocal
