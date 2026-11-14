# Stops and removes the always-on server (data and backups are not touched). One admin prompt:
# the server runs at boot without sign-in, so stopping it and removing the firewall rule need admin.
$ErrorActionPreference = 'Continue'
$admin = @'
Stop-ScheduledTask -TaskName 'PetrolPump Server' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'PetrolPump Server' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-server\.ps1' -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'next.+start') } |
  ForEach-Object { taskkill /T /F /PID $_.ProcessId | Out-Null }
Get-NetFirewallRule -DisplayName 'PetrolPump app (LAN)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
'@
$tmp = Join-Path $env:TEMP 'petrolpump-uninstall.ps1'
Set-Content -Path $tmp -Value $admin -Encoding UTF8
$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tmp
Remove-Item $tmp -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { Write-Output "WARNING: not removed (the admin prompt was refused)." }
elseif (Get-ScheduledTask -TaskName 'PetrolPump Server' -ErrorAction SilentlyContinue) { Write-Output "WARNING: the server task is still there." }
else { Write-Output "Server task removed. Database, backups and backup tasks are unchanged." }
