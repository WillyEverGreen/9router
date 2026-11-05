@echo off
setlocal
cd /d "%~dp0"
node scripts\test-outsourced-models.js %*

