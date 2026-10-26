@echo off
setlocal
title Available Models - 9Router

cd /d "%~dp0"
node "%~dp0scripts\list-models.js"
echo.
pause
