@echo off
setlocal
title Start Antigravity IDE
echo [*] Starting Antigravity IDE...
where agy-start.cmd >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] agy-start.cmd not found in PATH.
    exit /b 1
)
call agy-start.cmd %*
exit /b %errorlevel%
