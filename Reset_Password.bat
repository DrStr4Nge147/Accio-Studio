@echo off
chcp 65001 >nul
setlocal
title Accio Studio - reset password
cd /d "%~dp0"

if not exist "env\Scripts\python.exe" (
    echo [ERROR] Python environment not found. Please run Install.bat first.
    pause
    exit /b 1
)
echo.
echo This removes the Accio password and signs every device out.
echo The next time you open Accio it asks you to set a new password.
echo Your images and history are not touched.
echo.
set /p CONFIRM="Reset the password? [y/N]: "
if /i not "%CONFIRM%"=="y" (
    echo Nothing changed.
    pause
    exit /b 0
)
env\Scripts\python.exe server\settings_cli.py reset_password
echo.
echo If Accio is running, restart it so it shows the setup screen.
pause
endlocal
