$port = 20127
$node = 'C:\Program Files\nodejs\node.exe'
$cli  = Join-Path $env:APPDATA 'npm\node_modules\9router\cli.js'

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "[9Router] Already running on port $port!" -ForegroundColor Green
    exit 0
}
if (-not (Test-Path $cli)) {
    Write-Host "[9Router] Not installed: $cli (run: npm i -g 9router)" -ForegroundColor Red
    exit 1
}

Write-Host "[9Router] Starting in background on port $port..." -ForegroundColor Cyan
Start-Process -FilePath $node -ArgumentList @($cli, '-p', "$port", '--skip-update', '--no-browser') -WindowStyle Hidden

for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "[9Router] Ready on http://localhost:$port!" -ForegroundColor Green
        exit 0
    }
}
Write-Host '[9Router] Still starting - check again with: 9r status' -ForegroundColor Yellow
exit 0
