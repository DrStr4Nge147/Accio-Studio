@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Accio Studio - zrok setup

cd /d "%~dp0"

set "ZROK_VERSION=1.1.11"
set "ACCIO_PORT=7862"
if exist "env\Scripts\python.exe" (
    for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py port`) do set "ACCIO_PORT=%%a"
)

echo.
echo =================================================================
echo Accio Studio - zrok setup (free, persistent URL)
echo =================================================================
echo.
echo This gives Accio its own permanent address, separate from any other app
echo you share with zrok. It is saved in .zrok_share in this folder.
echo.

:: Step 1: zrok.exe (pinned v1.1.x, kept in this folder)
if exist "zrok.exe" (
    zrok.exe version 2>&1 | find "v0.4" >nul
    if !errorlevel! equ 0 (
        echo [!] Old zrok version found. Upgrading to v%ZROK_VERSION%...
        del /f zrok.exe
    )
)
if not exist "zrok.exe" (
    echo [1/3] Downloading zrok v%ZROK_VERSION% ...
    curl.exe -L -f -o zrok.tar.gz "https://github.com/openziti/zrok/releases/download/v%ZROK_VERSION%/zrok_%ZROK_VERSION%_windows_amd64.tar.gz"
    if !errorlevel! neq 0 (
        echo [ERROR] Could not download zrok. Check the internet connection and try again.
        del /f zrok.tar.gz 2>nul
        pause
        exit /b 1
    )
    tar -xzf zrok.tar.gz zrok.exe
    if not exist "zrok.exe" (
        echo [ERROR] Could not extract zrok.exe from the download.
        del /f zrok.tar.gz 2>nul
        pause
        exit /b 1
    )
    del /f zrok.tar.gz
    echo       zrok ready.
) else (
    echo [1/3] zrok is already here.
)

:: Step 2: link this PC to a zrok account (skipped when it already is)
echo.
if exist "%USERPROFILE%\.zrok\environment.json" (
    echo [2/3] This PC is already linked to a zrok account. Skipping the token step.
) else (
    echo [2/3] Link this PC to your free zrok account.
    echo.
    echo   1. Register at https://zrok.io ^(free^) and click the link in the email.
    echo   2. In the zrok dashboard, copy your enable token.
    echo.
    start https://zrok.io
    set "TOKEN="
    set /p TOKEN="Paste your token here: "
    if "!TOKEN!"=="" (
        echo [ERROR] The token cannot be empty.
        pause
        exit /b 1
    )
    set "TOKEN=!TOKEN:zrok enable =!"
    zrok.exe enable !TOKEN!
    if !errorlevel! neq 0 (
        echo.
        echo [ERROR] zrok could not link this PC. Check the token and try again.
        pause
        exit /b 1
    )
)

:: Step 3: reserve a name for Accio
echo.
echo [3/3] Reserve Accio's own permanent name.
if exist ".zrok_share" (
    set /p CURRENT=<.zrok_share
    echo       Accio already has the name !CURRENT! ^(https://!CURRENT!.share.zrok.io^).
    set "KEEP=Y"
    set /p KEEP="Keep it? [Y/n]: "
    if /i not "!KEEP!"=="n" (
        set "NAME=!CURRENT!"
        goto :done
    )
)
echo       The name must be letters and digits only, 4 to 32 characters, and unique on zrok.
echo       Pick a NEW name, not the one used by another app.
set "NAME="
set /p NAME="Name for Accio [e.g. myaccio]: "
if "!NAME!"=="" (
    echo [ERROR] No name entered. Nothing was reserved.
    pause
    exit /b 1
)
zrok.exe reserve public http://127.0.0.1:%ACCIO_PORT% --unique-name !NAME!
if !errorlevel! neq 0 (
    echo.
    echo [ERROR] The reservation failed. The name may be taken or invalid. Run this again with another name.
    pause
    exit /b 1
)
> .zrok_share echo !NAME!
echo       Reserved: !NAME!

:done
echo.
echo =================================================================
echo READY
echo =================================================================
echo Start Accio with Run_Accio-zrok-only.bat, or pick option 3 in Run_Accio.bat.
echo Your address: https://!NAME!.share.zrok.io  ^(shown with a QR code when it starts^)
echo =================================================================
echo.
pause
endlocal
