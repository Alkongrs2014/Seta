# Registers scheduled task BTC-Tunnel: starts at logon, watchdog every minute (no duplicates: IgnoreNew + lock file).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cmd  = Join-Path $root "scripts\run-tunnel.cmd"
$name = "BTC-Tunnel"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`"" -WorkingDirectory $root
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $name -Action $action -Trigger @($t1,$t2) -Settings $settings -Principal $principal | Out-Null
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State | Format-Table -AutoSize
