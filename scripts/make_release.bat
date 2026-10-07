@echo off
chcp 65001 >nul
setlocal
title Accio Studio release

cd /d "%~dp0.."

:: Builds release\AccioStudio-VERSION.zip (see scripts\make_release.py). Extra arguments are passed on:
::   scripts\make_release.bat --build --version 1.0.0
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
