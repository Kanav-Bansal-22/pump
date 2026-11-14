# Keeps the petrol pump app running: starts the production server, restarts it within 5 seconds if it
# ever stops, and restarts it by itself when a new build appears (after `npm run build`), so updating
# never needs admin rights. Output goes to logs\server-YYYYMMDD.log (kept 30 days).
# Started at boot (and at logon) by the "PetrolPump Server" scheduled task (scripts\install-server.ps1).
param([int]$Port = 80)
$ErrorActionPreference = 'Continue'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
$logs = Join-Path $project 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
$next = Join-Path $project 'node_modules\next\dist\bin\next'
$buildFile = Join-Path $project '.next\BUILD_ID'

function Write-Log([string]$msg) {
  Add-Content (Join-Path $logs ("server-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))) ("[{0}] {1}" -f (Get-Date -Format s), $msg)
}
function Get-BuildId { if (Test-Path $buildFile) { ([IO.File]::ReadAllText($buildFile)).Trim() } else { '' } }
# A server left over from before (e.g. an older copy still holding the port) is stopped first; only node.
function Clear-Port {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') {
      Write-Log "stopping leftover server (pid $($p.Id)) on port $Port"
      & taskkill.exe /T /F /PID $p.Id | Out-Null
    }
  }
}

while ($true) {
  # wait while a build is running (it removes BUILD_ID until it finishes)
  while (-not (Get-BuildId)) { Start-Sleep -Seconds 5 }
  Clear-Port
  $build = Get-BuildId
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Write-Log "starting server on port $Port (build $build)"
  $proc = Start-Process -FilePath $node -ArgumentList @("`"$next`"", 'start', '-H', '0.0.0.0', '-p', "$Port") -WorkingDirectory $project `
    -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $logs "server-out-$stamp.log") -RedirectStandardError (Join-Path $logs "server-err-$stamp.log")
  while (-not $proc.HasExited) {
    Start-Sleep -Seconds 5
    $now = Get-BuildId
    if ($now -and $now -ne $build) {
      Write-Log "new build $now found: restarting the server"
      & taskkill.exe /T /F /PID $proc.Id | Out-Null
      break
    }
  }
  Write-Log "server stopped; restarting in 5 s"
  Get-ChildItem $logs -Filter 'server-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
}
