@echo off
setlocal
title RPG Campaign - Build and Install JSON Addons

pushd "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "extension\st-rpg-campaign\install.ps1"
set "RPG_SYNC_EXIT=%ERRORLEVEL%"
popd

if not "%RPG_SYNC_EXIT%"=="0" (
  echo.
  echo JSON addon sync preparation failed. Review the error above.
  pause
  exit /b %RPG_SYNC_EXIT%
)

echo.
echo Addons installed. Refresh SillyTavern, open RPG Campaign, and press Sync JSON Addons.
pause
exit /b 0
