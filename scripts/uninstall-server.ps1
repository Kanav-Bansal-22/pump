# Stops and removes the always-on server (data and backups are not touched).
$ErrorActionPreference = 'Continue'
Stop-ScheduledTask -TaskName 'PetrolPump Server' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'PetrolPump Server' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-server\.ps1' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'next.+start') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', "Get-NetFirewallRule -DisplayName 'PetrolPump app (LAN)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule"
Write-Output "Server task removed. Database, backups and backup tasks are unchanged."
