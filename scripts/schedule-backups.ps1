# Registers two Windows scheduled tasks for the current user (one admin prompt, so they run even when
# nobody is signed in; without admin they still work but only while this user is signed in):
#   "PetrolPump Nightly Backup"  every day at 02:00
#   "PetrolPump Hourly Backup"   every day from 07:00, repeating every hour for 16 hours (last run 23:00)
# They back up the database named by DB_NAME in .env (pump_demo until go-live, then pump_prod).
# The laptop must be on. Missed runs (laptop off) catch up when it is back on.
# Remove with: Unregister-ScheduledTask -TaskName "PetrolPump Nightly Backup","PetrolPump Hourly Backup" -Confirm:$false
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$log = Join-Path $project 'backups\task.log'
New-Item -ItemType Directory -Force (Join-Path $project 'backups') | Out-Null

function New-BackupAction([string]$kind) {
  New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c npm run -s backup -- $kind >> `"$log`" 2>&1" -WorkingDirectory $project
}
# Run even on battery, catch up if a run was missed (e.g. laptop was off), stop a stuck run after 30 min.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew

$nightlyTrigger = New-ScheduledTaskTrigger -Daily -At '02:00'
Register-ScheduledTask -TaskName 'PetrolPump Nightly Backup' -Action (New-BackupAction 'NIGHTLY') -Trigger $nightlyTrigger `
  -Settings $settings -Description 'Petrol pump database backup (nightly)' -Force | Out-Null

$hourlyTrigger = New-ScheduledTaskTrigger -Daily -At '07:00'
$repeat = New-ScheduledTaskTrigger -Once -At '07:00' -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours 16)
$hourlyTrigger.Repetition = $repeat.Repetition
Register-ScheduledTask -TaskName 'PetrolPump Hourly Backup' -Action (New-BackupAction 'HOURLY') -Trigger $hourlyTrigger `
  -Settings $settings -Description 'Petrol pump database backup (hourly, business hours)' -Force | Out-Null

# Run without sign-in (S4U: this Windows user, no password stored). Needs admin.
$admin = "`$p = New-ScheduledTaskPrincipal -UserId '$env:USERNAME' -LogonType S4U -RunLevel Limited; foreach (`$t in 'PetrolPump Nightly Backup','PetrolPump Hourly Backup') { Set-ScheduledTask -TaskName `$t -Principal `$p | Out-Null }"
$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $admin
if ($p.ExitCode -ne 0) { "NOTE: backups will run only while this user is signed in (admin step not applied)." }

foreach ($t in 'PetrolPump Nightly Backup', 'PetrolPump Hourly Backup') {
  $info = Get-ScheduledTaskInfo -TaskName $t
  "{0}: next run {1}" -f $t, $info.NextRunTime
}
