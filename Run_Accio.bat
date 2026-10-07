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

:: Self-heal: environment
if not exist "env\Scripts\python.exe" (
    echo [ERROR] Python environment not found. Please run Install.bat first.
    pause
    exit /b 1
)

:: Settings (settings.json is optional): bundled ComfyUI folder, port, flags saved by the installer
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py comfy_url`) do set "COMFY_URL=%%a"
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py comfy_port`) do set "COMFY_PORT=%%a"
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py comfy_dir`) do set "COMFY_DIR=%%a"
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py launch_flags`) do set "COMFY_FLAGS=%%a"
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py external`) do set "COMFY_EXTERNAL=%%a"

:: Step 1: ComfyUI (bundled; reuse it if it is already running)
echo [1/3] Checking ComfyUI at %COMFY_URL% ...
if "%COMFY_EXTERNAL%"=="1" (
    echo       Using an external ComfyUI ^(external_comfy_url in settings.json^); the bundled one is not started.
)
curl.exe -s -m 3 -o nul "%COMFY_URL%/system_stats"
if !errorlevel! equ 0 (
    echo       ComfyUI is already running.
    goto :comfy_ready
)
if "%COMFY_EXTERNAL%"=="1" (
    echo [ERROR] The external ComfyUI at %COMFY_URL% is not responding.
    pause
    exit /b 1
)
if not exist "%COMFY_DIR%\python_embeded\python.exe" (
    echo [ERROR] The bundled ComfyUI was not found at "%COMFY_DIR%".
    echo         Please run Install.bat first.
    pause
    exit /b 1
)
if not exist "data\logs" mkdir "data\logs"
echo       Starting ComfyUI... ^(own minimized window; log: data\logs\comfyui.log^)
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
start "ComfyUI (Accio)" /min /d "%COMFY_DIR%" cmd /c ".\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port %COMFY_PORT% --disable-auto-launch %COMFY_FLAGS% > "%~dp0data\logs\comfyui.log" 2>&1"
set /a WAITED=0

:wait_comfy
curl.exe -s -m 3 -o nul "%COMFY_URL%/system_stats"
if !errorlevel! equ 0 goto :comfy_ready
if !WAITED! geq 180 (
    echo [ERROR] ComfyUI did not answer within 3 minutes.
    echo         See data\logs\comfyui.log for the reason.
    pause
    exit /b 1
)
echo       Waiting for ComfyUI... ^(!WAITED!s^)
ping -n 4 127.0.0.1 >nul
set /a WAITED+=3
goto :wait_comfy

:comfy_ready
echo       ComfyUI is ready.

:: Step 2: Frontend build self-heal (release zips already contain frontend\dist)
echo.
echo [2/3] Checking the frontend build...
if not exist "frontend\dist\index.html" (
    echo       Frontend build missing. Building ^(this may take a minute^)...
    env\Scripts\python.exe installer\install.py --yes --skip-models
    if not exist "frontend\dist\index.html" (
        echo [ERROR] Could not build the frontend. Run Install.bat.
        pause
        exit /b 1
    )
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
