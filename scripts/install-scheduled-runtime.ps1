$ErrorActionPreference = 'Stop'
$supervisor = Join-Path $PSScriptRoot 'run-scheduled-app.ps1'
$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'Capitalcombot Scheduler.vbs'
$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $supervisor + '"'
$escapedCommand = $command.Replace('"', '""')
@"
Set shell = CreateObject("WScript.Shell")
shell.Run "$escapedCommand", 0, False
"@ | Set-Content -LiteralPath $launcher -Encoding Unicode
Write-Output "Installed login launcher: $launcher"
$workspace = Split-Path -Parent $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $supervisor + '"') -WorkingDirectory $workspace
$loginTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Capitalcombot Always On' -Action $action -Trigger @($loginTrigger,$recoveryTrigger) -Settings $settings -Principal $principal -Force | Out-Null
Write-Output 'Installed Windows recovery task: Capitalcombot Always On (login and every minute).'
