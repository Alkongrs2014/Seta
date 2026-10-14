# Registers scheduled task BTC-Opportunities: run at logon and boot, auto-restart on crash, single instance.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cmd  = Join-Path $root "scripts\run-server.cmd"
$name = "BTC-Opportunities"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`"" -WorkingDirectory $root
$triggers = @(New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
try { $triggers += New-ScheduledTaskTrigger -AtStartup } catch {}
# Watchdog: every minute; IgnoreNew + server lock make this a no-op while running
$wd = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$triggers += $wd
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
try {
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -Principal $principal | Out-Null
} catch {
  # AtStartup needs admin; fall back to logon trigger
  Register-ScheduledTask -TaskName $name -Action $action -Trigger @($triggers[0], $wd) -Settings $settings -Principal $principal | Out-Null
  Write-Host "Registered for logon only (boot-before-login needs admin)."
}
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State | Format-Table -AutoSize
(Get-ScheduledTask -TaskName $name).Triggers | ForEach-Object { $_.CimClass.CimClassName }
