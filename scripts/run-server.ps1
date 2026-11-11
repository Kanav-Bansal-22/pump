# Keeps the petrol pump app running: starts the production server and restarts it within
# 5 seconds if it ever stops. Output goes to logs\server-YYYYMMDD.log (kept 30 days).
# Started at logon by the "PetrolPump Server" scheduled task (scripts\install-server.ps1).
param([int]$Port = 80)
$ErrorActionPreference = 'Continue'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
$logs = Join-Path $project 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
$next = Join-Path $project 'node_modules\next\dist\bin\next'

while ($true) {
  $log = Join-Path $logs ("server-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
  Add-Content $log ("[{0}] starting server on port {1}" -f (Get-Date -Format s), $Port)
  & $node $next start -H 0.0.0.0 -p $Port *>> $log
  Add-Content $log ("[{0}] server stopped (exit {1}); restarting in 5 s" -f (Get-Date -Format s), $LASTEXITCODE)
  Get-ChildItem $logs -Filter 'server-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
}
