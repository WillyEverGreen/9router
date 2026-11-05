@echo off
setlocal
title Stop Antigravity IDE
echo [!] Warning: This will terminate all running Antigravity IDE processes.
taskkill /F /IM "Antigravity IDE.exe" /T >nul 2>&1
taskkill /F /IM "Antigravity.exe" /T >nul 2>&1
echo [*] Done.

