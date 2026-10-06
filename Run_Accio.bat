@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Accio Studio

cd /d "%~dp0"

echo.
echo =================================================================
echo Accio Studio
echo =================================================================
echo.

:: Defaults (override in settings.json: comfy_url, comfy_dir)
set "COMFY_URL=http://127.0.0.1:8188"
set "COMFY_DIR=E:\AI_Softwares\ImageGenerator\Merged\ComfyUI_windows_portable"

:: Self-heal: environment
if not exist "env\Scripts\python.exe" (
    echo [ERROR] Python environment not found. Please run Install.bat first.
    pause
    exit /b 1
)

:: Read optional overrides from settings.json
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py comfy_url`) do set "COMFY_URL=%%a"
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py comfy_dir`) do set "COMFY_DIR=%%a"

:: Step 1: ComfyUI (reuse if running, otherwise launch and wait)
echo [1/3] Checking ComfyUI at %COMFY_URL% ...
curl.exe -s -m 3 -o nul "%COMFY_URL%/system_stats"
if !errorlevel! equ 0 (
    echo       ComfyUI is already running.
    goto :comfy_ready
)
if not exist "%COMFY_DIR%\python_embeded\python.exe" (
    echo [ERROR] ComfyUI not found at "%COMFY_DIR%".
    echo         Set comfy_dir in settings.json, or start ComfyUI yourself.
    pause
    exit /b 1
)
echo       Starting ComfyUI in its own window...
start "ComfyUI" /d "%COMFY_DIR%" cmd /c ".\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --disable-cuda-malloc --reserve-vram 1"
set /a WAITED=0

:wait_comfy
curl.exe -s -m 3 -o nul "%COMFY_URL%/system_stats"
if !errorlevel! equ 0 goto :comfy_ready
if !WAITED! geq 180 (
    echo [ERROR] ComfyUI did not answer within 3 minutes. Check its window for errors.
    pause
    exit /b 1
)
echo       Waiting for ComfyUI... ^(!WAITED!s^)
timeout /t 3 /nobreak >nul
set /a WAITED+=3
goto :wait_comfy

:comfy_ready
echo       ComfyUI is ready.

:: Step 2: Frontend build self-heal
echo.
echo [2/3] Checking the frontend build...
if not exist "frontend\dist\index.html" (
    echo       Frontend build missing. Building ^(this may take a minute^)...
    where npm >nul 2>&1
    if !errorlevel! neq 0 (
        echo [ERROR] npm not found. Install Node.js or run Install.bat.
        pause
        exit /b 1
    )
    pushd frontend
    call npm install --no-audit --no-fund
    call npm run build
    popd
)

:: Step 3: Connection mode
echo.
echo =================================================================
echo Choose Connection Mode
echo =================================================================
echo 1. LOCAL ONLY ^(Wi-Fi / LAN^)
echo 2. CLOUDFLARE ^(random URL^)
echo 3. ZROK ^(persistent URL^)
echo =================================================================
set "TUNNEL=local"
set /p CHOICE="Selection [1-3, Default=1]: "
if "%CHOICE%"=="2" set "TUNNEL=cloudflare"
if "%CHOICE%"=="3" set "TUNNEL=zrok"

echo.
echo [3/3] Launching Accio Studio ^(%TUNNEL%^)...
env\Scripts\python.exe server\main.py --tunnel %TUNNEL%

if %ERRORLEVEL% neq 0 (
    echo.
    echo Accio Studio stopped with an error.
    pause
)
endlocal
