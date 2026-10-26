param(
    [string]$Port = "20127"
)

$Host.UI.RawUI.WindowTitle = "9Router Gateway & Dashboard"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "                       9Router - Local AI Gateway & Dashboard                  " -ForegroundColor Cyan
Write-Host "===============================================================================`n" -ForegroundColor Cyan

# 1. Verify .env
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Write-Host "[*] .env not found. Creating from .env.example..." -ForegroundColor Yellow
        Copy-Item ".env.example" ".env"
    } else {
        Write-Warning "[!] .env and .env.example not found."
    }
}

# 2. Verify dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "[*] Installing dependencies (first run)..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[!] npm install failed."
        exit $LASTEXITCODE
    }
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Error "Port $Port is already in use - a 9Router gateway is running. Run `9r stop` first (two instances sharing one database can corrupt OAuth token rotation)."
    exit 1
}

Write-Host "[*] Starting 9Router server on port $Port..." -ForegroundColor Green
Write-Host "[*] Web Dashboard : http://localhost:$Port/dashboard" -ForegroundColor Green
Write-Host "[*] OpenAI API    : http://localhost:$Port/v1`n" -ForegroundColor Green

$env:PORT = $Port
$env:NEXT_PUBLIC_BASE_URL = "http://localhost:$Port"

npx next dev --port $Port
