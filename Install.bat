@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Accio Studio Installer

cd /d "%~dp0"

echo.
echo ==========================================
echo Accio Studio Installer
echo ==========================================
echo (Nothing is installed into ComfyUI.)
echo.

set "PATH=%~dp0bin;%PATH%"
set "UV_PYTHON_INSTALL_DIR=%~dp0bin\python"
set "UV_PYTHON_PREFERENCE=only-managed"
set "UV_CACHE_DIR=%~dp0bin\uv-cache"

:: [1/4] Portable uv
if not exist "bin\uv.exe" (
    echo [1/4] Downloading portable uv...
    if not exist "bin" mkdir bin
    curl.exe -L -o uv.zip "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
    if !errorlevel! neq 0 goto :fail
    tar -xf uv.zip
    move /Y uv.exe bin\uv.exe >nul
    if exist "uvw.exe" del uvw.exe >nul
    if exist "uvx.exe" del uvx.exe >nul
    del uv.zip
) else (
    echo [1/4] uv already present.
)

:: [2/4] Project venv (Python 3.12, managed by uv, separate from ComfyUI)
if not exist "env\Scripts\python.exe" (
    echo [2/4] Creating Python environment ^(env^)...
    uv python install 3.12
    if !errorlevel! neq 0 goto :fail
    uv venv --python 3.12 env
    if !errorlevel! neq 0 goto :fail
) else (
    echo [2/4] Python environment already exists.
)

:: [3/4] Python requirements
echo [3/4] Installing Python requirements...
uv pip install --python env\Scripts\python.exe -r requirements.txt
if !errorlevel! neq 0 goto :fail

:: [4/4] Frontend
echo [4/4] Building the frontend...
where npm >nul 2>&1
if !errorlevel! neq 0 (
    echo [ERROR] Node.js/npm not found. Install Node.js, then run this again.
    goto :fail
)
pushd frontend
call npm install --no-audit --no-fund
if !errorlevel! neq 0 ( popd & goto :fail )
call npm run build
if !errorlevel! neq 0 ( popd & goto :fail )
popd

echo.
echo ==========================================
echo Installation complete. Use Run_Accio.bat to start.
echo ==========================================
if /i not "%~1"=="nopause" pause
endlocal
exit /b 0

:fail
echo.
echo [ERROR] Installation failed. See the messages above.
if /i not "%~1"=="nopause" pause
endlocal
exit /b 1
