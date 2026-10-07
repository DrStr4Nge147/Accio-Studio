@echo off
chcp 65001 >nul
title Accio Studio (zrok)
cd /d "%~dp0"
:: Same as Run_Accio.bat, but skips the connection menu and goes straight to zrok.
call "%~dp0Run_Accio.bat" zrok
