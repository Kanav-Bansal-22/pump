# Installs the petrol pump app as an always-on local server on this laptop.
#   powershell -ExecutionPolicy Bypass -File scripts\install-server.ps1
# 1. builds the production app
# 2. registers "PetrolPump Server" (starts at logon of this Windows user, keeps running, restarts on crash)
# 3. ONE admin prompt: firewall rule (port 80, Private networks only, local subnet only) and
#    power plan (never sleep / hibernate on mains power, closing the lid does nothing)
# 4. starts the server and checks /api/health
# Undo: scripts\uninstall-server.ps1
param([int]$Port = 80, [switch]$SkipBuild, [switch]$SkipSystem)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

if (-not $SkipBuild) {
  Write-Output "Building the app (1-2 minutes)..."
  npm run build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Build failed. Nothing was installed." }
}

$runner = Join-Path $project 'scripts\run-server.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Port $Port" -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'PetrolPump Server' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Petrol pump app: local server for phones on the shop Wi-Fi' -Force | Out-Null
Write-Output "Registered scheduled task 'PetrolPump Server' (starts at logon)."

if (-not $SkipSystem) {
  $admin = @"
`$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -DisplayName 'PetrolPump app (LAN)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'PetrolPump app (LAN)' -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Private -RemoteAddress LocalSubnet -Action Allow | Out-Null
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
"@
  $tmp = Join-Path $env:TEMP 'petrolpump-admin.ps1'
  Set-Content -Path $tmp -Value $admin -Encoding UTF8
  $p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tmp
  Remove-Item $tmp -ErrorAction SilentlyContinue
  if ($p.ExitCode -ne 0) { Write-Output "WARNING: firewall / power settings were not applied (admin step exit $($p.ExitCode))." }
  else { Write-Output "Firewall: port $Port open for Private networks (local subnet only). Power: no sleep on mains, lid close = do nothing." }
}

Start-ScheduledTask -TaskName 'PetrolPump Server'
$ok = $false
for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
  Start-Sleep -Milliseconds 750
  try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; $ok = $h.ok } catch { }
}
if (-not $ok) { throw "The server did not answer on port $Port. See logs\server-*.log" }
$ips = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address.IPAddress }
Write-Output "Server is running."
foreach ($ip in $ips) { Write-Output ("Phones on this Wi-Fi open:  http://{0}{1}" -f $ip, $(if ($Port -eq 80) { '' } else { ":$Port" })) }
Get-NetConnectionProfile | ForEach-Object {
  if ($_.NetworkCategory -ne 'Private') { Write-Output "NOTE: Wi-Fi '$($_.Name)' is $($_.NetworkCategory): phones cannot connect until it is set to Private (only do that on the pump's own Wi-Fi)." }
}
