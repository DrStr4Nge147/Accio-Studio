@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Accio Studio Installer

cd /d "%~dp0"

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

set "PATH=%~dp0bin;%PATH%"
set "UV_PYTHON_INSTALL_DIR=%~dp0bin\python"
set "UV_PYTHON_PREFERENCE=only-managed"
set "UV_CACHE_DIR=%~dp0bin\uv-cache"

:: [1/3] Portable uv
if not exist "bin\uv.exe" (
    echo [1/3] Downloading portable uv...
    if not exist "bin" mkdir bin
    curl.exe -L -f --ssl-no-revoke -o uv.zip "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
    if !errorlevel! neq 0 goto :fail
    tar -xf uv.zip
    move /Y uv.exe bin\uv.exe >nul
    if exist "uvw.exe" del uvw.exe >nul
    if exist "uvx.exe" del uvx.exe >nul
    del uv.zip
) else (
    echo [1/3] uv already present.
)

:: [2/3] Accio server environment (Python 3.12 managed by uv; separate from ComfyUI's Python)
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

:fail
echo.
echo [ERROR] Installation did not finish. See the messages above, then run Install.bat again.
if not defined NOPAUSE pause
endlocal
exit /b 1
