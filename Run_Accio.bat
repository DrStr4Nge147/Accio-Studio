@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Accio Studio

cd /d "%~dp0"

:: "Run_Accio.bat zrok" (used by Run_Accio-zrok-only.bat) skips the connection menu and goes straight to zrok.
set "TUNNEL="
if /i "%~1"=="zrok" set "TUNNEL=zrok"

echo.
echo =================================================================
echo Accio Studio
echo =================================================================
echo.

if "%TUNNEL%"=="zrok" if not exist "zrok.exe" (
    echo [ERROR] zrok is not set up yet. Run Setup_Zrok.bat first.
    pause
    exit /b 1
)

:: Self-heal: environment
if not exist "env\Scripts\python.exe" (
    echo [ERROR] Python environment not found. Please run Install.bat first.
    pause
    exit /b 1
)
env\Scripts\python.exe -c "import sys" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] The Python environment does not start. This usually means the folder was moved or renamed after installing.
    echo         Run Install.bat: it rebuilds the environment and keeps everything else.
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
echo [1/3] Checking the backend at %COMFY_URL% ...
if "%COMFY_EXTERNAL%"=="1" (
    echo       Using an external backend ^(external_comfy_url in settings.json^); the bundled one is not started.
)
curl.exe -s -m 3 -o nul "%COMFY_URL%/system_stats"
if !errorlevel! equ 0 (
    echo       The backend is already running.
    goto :comfy_ready
)
if "%COMFY_EXTERNAL%"=="1" (
    echo [ERROR] The external backend at %COMFY_URL% is not responding.
    pause
    exit /b 1
)
if not exist "%COMFY_DIR%\python_embeded\python.exe" (
    echo [ERROR] The bundled backend was not found at "%COMFY_DIR%".
    echo         Please run Install.bat first.
    pause
    exit /b 1
)
if not exist "data\logs" mkdir "data\logs"
echo       Starting the backend... ^(hidden; its console is in the app, log file: data\logs\comfyui.log^)
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "COMFY_LOG=%~dp0data\logs\comfyui.log"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; Start-Process -FilePath cmd.exe -WorkingDirectory $env:COMFY_DIR -WindowStyle Hidden -ArgumentList ('/c ' + $q + '.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port ' + $env:COMFY_PORT + ' --disable-auto-launch ' + $env:COMFY_FLAGS + ' > ' + $q + $env:COMFY_LOG + $q + ' 2>&1' + $q)"
set /a WAITED=0

:wait_comfy
curl.exe -s -m 3 -o nul "%COMFY_URL%/system_stats"
if !errorlevel! equ 0 goto :comfy_ready
if !WAITED! geq 180 (
    echo [ERROR] The backend did not answer within 3 minutes.
    echo         See the ComfyUI log, data\logs\comfyui.log, for the reason.
    pause
    exit /b 1
)
echo       Waiting for the backend... ^(!WAITED!s^)
ping -n 4 127.0.0.1 >nul
set /a WAITED+=3
goto :wait_comfy

:comfy_ready
echo       The backend is ready.

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
set "HOST_ARG="
if "%TUNNEL%"=="zrok" goto :launch
echo.
echo =================================================================
echo Choose Connection Mode
echo =================================================================
echo 1. LOCAL ONLY ^(this PC, 127.0.0.1^)
echo 2. CLOUDFLARE ^(random URL, downloads cloudflared on first use^)
echo 3. ZROK ^(persistent URL, run Setup_Zrok.bat once first^)
echo 4. SAME NETWORK ^(other devices on your Wi-Fi / LAN^)
echo 5. TAILSCALE ^(private: only your own devices; needs the Tailscale app^)
echo =================================================================
set "TUNNEL=local"
set /p CHOICE="Selection [1-5, Default=1]: "
if "%CHOICE%"=="2" set "TUNNEL=cloudflare"
if "%CHOICE%"=="3" set "TUNNEL=zrok"
if "%CHOICE%"=="5" set "TUNNEL=tailscale"
if "%CHOICE%"=="4" (
    set "HOST_ARG=--host 0.0.0.0"
    echo.
    echo       Other devices on this network can open the LAN address shown below.
    echo       Everything is behind your Accio password. If Windows Firewall asks, allow access on private networks.
)
if "%TUNNEL%"=="zrok" if not exist "zrok.exe" (
    echo.
    echo [ERROR] zrok is not set up yet. Run Setup_Zrok.bat first, then start this again.
    pause
    exit /b 1
)

:launch
echo.
echo [3/3] Launching Accio Studio ^(%TUNNEL%^)...
echo       The first time, the app asks you to set a password. Forgot it? Run Reset_Password.bat.
env\Scripts\python.exe server\main.py --tunnel %TUNNEL% %HOST_ARG% --open-browser

if %ERRORLEVEL% neq 0 (
    echo.
    echo Accio Studio stopped with an error.
    pause
)
endlocal
