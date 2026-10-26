@echo off
setlocal
title 9Router Gateway & Dashboard

cd /d "%~dp0"

echo ===============================================================================
echo                        9Router - Local AI Gateway & Dashboard
echo ===============================================================================
echo.

REM 1. Verify .env
if not exist ".env" (
    if exist ".env.example" (
        echo [*] .env not found. Creating .env from .env.example...
        copy /y ".env.example" ".env" >nul
    ) else (
        echo [!] Warning: .env and .env.example not found.
    )
)

REM 2. Verify dependencies
if not exist "node_modules\" (
    echo [*] Installing dependencies (first run)...
    call npm install
    if errorlevel 1 (
        echo [!] npm install failed.
        pause
        exit /b %errorlevel%
    )
)

REM 3. Determine port (default 20127, or pass as %1)
set APP_PORT=20127
if not "%~1"=="" (
    set APP_PORT=%~1
)

echo [*] Starting 9Router server on port %APP_PORT%...
echo [*] Web Dashboard : http://localhost:%APP_PORT%/dashboard
echo [*] OpenAI API    : http://localhost:%APP_PORT%/v1
echo.

set PORT=%APP_PORT%
set NEXT_PUBLIC_BASE_URL=http://localhost:%APP_PORT%
call npx next dev --port %APP_PORT%

if errorlevel 1 (
    echo.
    echo [!] Server stopped or encountered an error.
    pause
)
