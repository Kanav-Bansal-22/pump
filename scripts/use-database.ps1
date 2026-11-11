# Switches the app between the practice database and the real one, then restarts the server.
#   powershell -ExecutionPolicy Bypass -File scripts\use-database.ps1 prod    (go-live day)
#   powershell -ExecutionPolicy Bypass -File scripts\use-database.ps1 demo    (practice)
#   powershell -ExecutionPolicy Bypass -File scripts\use-database.ps1 rehearsal (clean go-live rehearsal)
# Backups and the backup tasks follow the same setting automatically.
param([Parameter(Mandatory = $true)][ValidateSet('prod', 'demo', 'rehearsal')][string]$Which)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $project '.env'
$db = @{ prod = 'pump_prod'; demo = 'pump_demo'; rehearsal = 'pump_test' }[$Which]
$lines = Get-Content $envFile
if (-not ($lines -match '^DB_NAME=')) { throw ".env has no DB_NAME line. Run npm run db:setup first." }
$lines = $lines -replace '^DB_NAME=.*$', "DB_NAME=$db"
[System.IO.File]::WriteAllLines($envFile, $lines)
Write-Output "Active database is now: $db"

if (Get-ScheduledTask -TaskName 'PetrolPump Server' -ErrorAction SilentlyContinue) {
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'next.+start' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Write-Output "Server restarting with $db (takes about 10 seconds)..."
  $ok = $false
  for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 750
    try { $ok = (Invoke-RestMethod 'http://127.0.0.1/api/health' -TimeoutSec 3).ok } catch { }
  }
  if ($ok) { Write-Output "Server is back." } else { Write-Output "Server did not answer yet: check logs\server-*.log" }
}
if ($Which -eq 'prod') { Write-Output "REAL DATA from now on: the orange DEMO banner disappears." }
