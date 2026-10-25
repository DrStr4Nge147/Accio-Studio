@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Accio Studio - Tailscale setup

cd /d "%~dp0"

if not exist "env\Scripts\python.exe" (
    echo [ERROR] Python environment not found. Please run Install.bat first.
    pause
    exit /b 1
)

set "ACCIO_PORT=7862"
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py port`) do set "ACCIO_PORT=%%a"

echo.
echo =================================================================
echo Accio Studio - Tailscale setup
echo =================================================================
echo A private address that only your own devices can open.
echo Each step is checked automatically and the next one starts by itself.

env\Scripts\python.exe installer\connect_setup.py tailscale --port %ACCIO_PORT%
set "RC=!errorlevel!"
echo.
if not "!RC!"=="0" echo Setup did not finish. Run this file again to continue where it stopped.
pause
exit /b !RC!
