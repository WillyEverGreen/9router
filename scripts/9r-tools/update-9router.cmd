@echo off
echo [9Router] Installing latest 9router...
call npm install -g 9router@latest
if errorlevel 1 exit /b %errorlevel%
call "%~dp0stop-9router.cmd"
timeout /t 2 /nobreak >nul
call "%~dp0start-9router.cmd"
