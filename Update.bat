@echo off
chcp 65001 >nul
title Accio Studio update
cd /d "%~dp0"

:: Finds the newest release, checks its SHA-256, stops Accio, swaps the app files and runs Install.bat for anything new.
:: Your history, password, settings and models are not touched. Options (see installer\update.py): --check  --yes  --force  --zip FILE
:: The last command line below must stay ONE line ending in "exit /b": the update replaces this very file while it runs.
echo.
echo =================================================================
echo Accio Studio update
echo =================================================================
echo Close any other Accio window first ^(the one running Run_Accio.bat^). Your data, password and models are kept.
echo.
if not exist "env\Scripts\python.exe" (
    echo [ERROR] Python environment not found. Please run Install.bat first.
    pause
    exit /b 1
)
env\Scripts\python.exe -c "import sys" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] The Python environment does not start. Run Install.bat: it rebuilds it.
    pause
    exit /b 1
)
env\Scripts\python.exe installer\update.py %* & echo. & pause & exit /b
