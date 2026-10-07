@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Stop Accio Studio

cd /d "%~dp0"

echo.
echo =================================================================
echo Stop Accio Studio
echo =================================================================
echo.

if not exist "env\Scripts\python.exe" (
    echo [ERROR] Python environment not found. Nothing to stop ^(run Install.bat first^).
    pause
    exit /b 1
)

for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py port`) do set "ACCIO_PORT=%%a"
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py comfy_port`) do set "COMFY_PORT=%%a"
for /f "usebackq delims=" %%a in (`env\Scripts\python.exe server\settings_cli.py external`) do set "COMFY_EXTERNAL=%%a"
set "ACCIO_ROOT=%CD%"

echo Stopping what this folder started:
echo   - the Accio server ^(port %ACCIO_PORT%^)
if "%COMFY_EXTERNAL%"=="1" (
    echo   - the external backend is left alone ^(external_comfy_url is set^)
) else (
    echo   - the bundled backend ^(ComfyUI, port %COMFY_PORT%^)
)
echo   - cloudflared / zrok tunnels started from this folder
echo   - the Tailscale address Accio published ^(Tailscale itself keeps running^)
echo.

:: Only processes of this folder are stopped: programs located under it, and whatever listens on its two ports as long as it
:: is one of our main.py scripts. Z-Fusion, a separate ComfyUI or anything else on the PC is not touched.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = $env:ACCIO_ROOT.TrimEnd('\') + '\';" ^
  "$ports = @([int]$env:ACCIO_PORT); if ($env:COMFY_EXTERNAL -ne '1') { $ports += [int]$env:COMFY_PORT };" ^
  "$all = Get-CimInstance Win32_Process;" ^
  "$ids = @{};" ^
  "foreach ($p in $all) { if ($p.ProcessId -ne $PID -and $p.ExecutablePath -and $p.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $ids[[int]$p.ProcessId] = $p } }" ^
  "foreach ($port in $ports) { Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object { $op = $_.OwningProcess; $o = $all | Where-Object { $_.ProcessId -eq $op } | Select-Object -First 1; if ($o -and $o.CommandLine -match 'main\.py') { $ids[[int]$o.ProcessId] = $o } } }" ^
  "if ($ids.Count -eq 0) { Write-Host 'Nothing of Accio Studio was running.'; exit 0 }" ^
  "foreach ($p in $ids.Values) { Write-Host ('  stopping ' + $p.Name + ' (PID ' + $p.ProcessId + ')'); Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }" ^
  "Start-Sleep -Seconds 2;" ^
  "$left = @(); foreach ($port in $ports) { if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { $left += $port } }" ^
  "if ($left.Count) { Write-Host ('Still listening on port(s): ' + ($left -join ', ')); exit 2 } else { Write-Host 'Done. Ports are free.' }"

set "STOP_RC=!errorlevel!"

set "TS_EXE=%ProgramFiles%\Tailscale\tailscale.exe"
if exist "!TS_EXE!" (
    :: Switch off the HTTPS 443 entry only if it points at Accio's port (Run_Accio.bat option 5); other Tailscale settings stay.
    "!TS_EXE!" serve status 2>nul | find "127.0.0.1:%ACCIO_PORT%" >nul
    if !errorlevel! equ 0 "!TS_EXE!" serve --https=443 off >nul 2>&1
)

if !STOP_RC! equ 2 (
    echo.
    echo Something else is using those ports. Close it, or run this again.
)
echo.
pause
