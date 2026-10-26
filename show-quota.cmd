@echo off
setlocal
title Quota and Account Pools - 9Router

cd /d "%~dp0"
node "%~dp0scripts\show-quota.js"
echo.
pause
