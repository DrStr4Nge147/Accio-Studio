@echo off
chcp 65001 >nul
setlocal
title Accio Studio release

cd /d "%~dp0.."

:: Double-click it (or run it with no arguments) and pick the kind of release from the menu.
:: Runs the tests, rebuilds the frontend and builds release\AccioStudio-VERSION.zip (see scripts\make_release.py). Arguments skip the menu:
::   scripts\make_release.bat --bump patch        (or minor / major: also commits and tags the new version)
::   scripts\make_release.bat --version 1.0.0
::   scripts\make_release.bat --skip-tests --no-build --allow-dirty   (other switches, see make_release.py)
if not exist "env\Scripts\python.exe" (
    echo [ERROR] Python environment not found. Please run Install.bat first.
    pause
    exit /b 1
)
env\Scripts\python.exe scripts\make_release.py %*
if errorlevel 1 (
    pause
    exit /b 1
)
if "%~1"=="" pause
