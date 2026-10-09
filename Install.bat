@echo off
chcp 65001 >nul
title Accio Studio Installer

cd /d "%~dp0"

:: Refuse a folder the install cannot work in before anything is downloaded. This runs before delayed expansion is switched
:: on because a "!" in the path would be eaten by it. The length limit is MAX_ROOT_PATH_LEN in installer\core.py (a test keeps both equal).
if "%ACCIO_SKIP_PATH_CHECK%"=="1" goto :path_ok
set "ACCIO_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:ACCIO_DIR.TrimEnd('\'); if ($p.Contains('!')) { exit 13 }; if ($p.Length -gt 100) { exit 12 }; exit 0"
if "%ERRORLEVEL%"=="13" goto :bad_char
if "%ERRORLEVEL%"=="12" goto :too_long
:path_ok
setlocal enabledelayedexpansion

echo.
echo ==========================================
echo Accio Studio Installer
echo ==========================================
echo Everything is installed inside this folder (no admin rights, no PATH changes).
echo Deleting the folder uninstalls it. Re-running this file resumes where it stopped.
echo.

:: "nopause" = do not wait for a key at the end; every other argument goes to the installer
::   Install.bat --models-from "D:\ComfyUI\models" --optional-loras no --yes
set "NOPAUSE="
set "ARGS=%*"
if defined ARGS if not "!ARGS:nopause=!"=="!ARGS!" set "NOPAUSE=1"
if defined ARGS set "ARGS=!ARGS:nopause=!"

:: uv is pinned (not "latest") so an installation done next year behaves like one done today; it also decides which Python 3.12 is fetched.
set "UV_VERSION=0.12.23"
set "UV_SHA256=75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90"
set "PATH=%~dp0bin;%PATH%"
set "UV_PYTHON_INSTALL_DIR=%~dp0bin\python"
set "UV_PYTHON_PREFERENCE=only-managed"
set "UV_CACHE_DIR=%~dp0bin\uv-cache"

:: [1/3] Portable uv
if not exist "bin\uv.exe" (
    echo [1/3] Downloading portable uv %UV_VERSION%...
    if not exist "bin" mkdir bin
    curl.exe -L -f --ssl-no-revoke --connect-timeout 30 --speed-time 60 --speed-limit 1024 --retry 3 --retry-delay 3 -o uv.zip "https://github.com/astral-sh/uv/releases/download/%UV_VERSION%/uv-x86_64-pc-windows-msvc.zip"
    if !errorlevel! neq 0 goto :fail
    powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-FileHash -LiteralPath 'uv.zip' -Algorithm SHA256).Hash -ne $env:UV_SHA256.ToUpper()) { exit 1 }"
    if !errorlevel! neq 0 (
        echo [ERROR] The downloaded uv does not match its expected checksum. Check the connection and run Install.bat again.
        del uv.zip
        goto :fail
    )
    tar -xf uv.zip
    move /Y uv.exe bin\uv.exe >nul
    if exist "uvw.exe" del uvw.exe >nul
    if exist "uvx.exe" del uvx.exe >nul
    del uv.zip
) else (
    echo [1/3] uv already present.
)

:: [2/3] Accio server environment (Python 3.12 managed by uv; separate from ComfyUI's Python)
:: The environment points at absolute paths, so moving or renaming this folder breaks it: rebuild it then.
if exist "env\Scripts\python.exe" (
    env\Scripts\python.exe -c "import sys" >nul 2>&1
    if !errorlevel! neq 0 (
        echo [2/3] The Python environment does not start ^(this folder was probably moved or renamed^). Rebuilding it...
        rmdir /s /q env
    )
)
if not exist "env\Scripts\python.exe" (
    echo [2/3] Creating the Python environment ^(env^)...
    uv python install 3.12
    if !errorlevel! neq 0 goto :fail
    uv venv --python 3.12 env
    if !errorlevel! neq 0 goto :fail
) else (
    echo [2/3] Python environment already exists.
)
uv pip install --python env\Scripts\python.exe -r requirements.txt
if !errorlevel! neq 0 goto :fail

:: [3/3] Portable 7-Zip, GPU detection, ComfyUI, pinned nodes, models, frontend build if needed
echo [3/3] Installing the bundled ComfyUI, custom nodes and models...
env\Scripts\python.exe installer\install.py !ARGS!
if !errorlevel! neq 0 goto :fail

echo.
echo ==========================================
echo Installation complete. Use Run_Accio.bat to start.
echo ==========================================
if not defined NOPAUSE pause
endlocal
exit /b 0

:too_long
echo.
echo [ERROR] This folder path is too long ^(more than 100 characters^):
echo         "%~dp0"
echo         Windows cannot load some of the engine's files from a path that deep.
echo         Move the whole folder closer to the drive root, for example C:\AccioStudio, and run Install.bat again.
echo.
echo %* | find /i "nopause" >nul
if errorlevel 1 pause
exit /b 1

:bad_char
echo.
echo [ERROR] This folder path contains an exclamation mark, which Windows batch files cannot handle:
echo         "%~dp0"
echo         Move the whole folder to a path without it, for example C:\AccioStudio, and run Install.bat again.
echo.
echo %* | find /i "nopause" >nul
if errorlevel 1 pause
exit /b 1

:fail
echo.
echo [ERROR] Installation did not finish. See the messages above, then run Install.bat again.
if not defined NOPAUSE pause
endlocal
exit /b 1
