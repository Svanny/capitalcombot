param(
    [Parameter(Mandatory)][string]$TrackerWorkspace,
    [string]$NodeExecutable = (Get-Command node.exe).Source
)
$ErrorActionPreference = 'Stop'
$botWorkspace = Split-Path -Parent $PSScriptRoot
$TrackerWorkspace = (Resolve-Path -LiteralPath $TrackerWorkspace).Path
$version = & $NodeExecutable --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { throw 'Select a supported Node runtime with -NodeExecutable.' }
$nodeVersion = [version]$version.TrimStart('v')
$supported = ($nodeVersion.Major -eq 22 -and $nodeVersion -ge [version]'22.23.4') -or
    ($nodeVersion.Major -eq 24 -and $nodeVersion -ge [version]'24.22.1') -or
    ($nodeVersion.Major -eq 26 -and $nodeVersion -ge [version]'26.12.1')
if (!$supported) { throw 'Select a Node runtime satisfying both package.json engine constraints.' }
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'capitalcom-dev-runtime'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$runtimeNode = Join-Path $runtimeRoot 'node.exe'
if ([IO.Path]::GetFullPath($NodeExecutable) -ne $runtimeNode -and
    (!(Test-Path -LiteralPath $runtimeNode) -or (Get-FileHash -LiteralPath $NodeExecutable).Hash -ne (Get-FileHash -LiteralPath $runtimeNode).Hash)) {
    Copy-Item -LiteralPath $NodeExecutable -Destination $runtimeNode -Force
}
$pnpm = (Get-Command pnpm.exe).Source
$watcher = Join-Path $PSScriptRoot 'watch-dev-runtime.mjs'
$hashProvider = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($hashProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($botWorkspace.ToLowerInvariant()))).Replace('-', '').Substring(0,16).ToLowerInvariant() }
finally { $hashProvider.Dispose() }
$profiles = @(
    @{name='capitalcombot'; workspace=$botWorkspace; port=5173; watchPort=18731; title='Capital.com Trading Assistant'; protocol='tcp'; commandFile=(Join-Path $env:TEMP "capitalcombot-cli-$hash.json"); task='Capitalcombot Dev Always On'},
    @{name='capitalcomgoldperformancetracker'; workspace=$TrackerWorkspace; port=5174; watchPort=18732; title='Gold Performance Tracker'; protocol='http'; commandFile=(Join-Path $TrackerWorkspace '.gold-tracker-cli.json'); task='Capitalcomgoldperformancetracker Dev Always On'}
)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($profile in $profiles) {
    if (!(Test-Path -LiteralPath (Join-Path $profile.workspace 'package.json'))) { throw "Missing project: $($profile.workspace)" }
    $profile.runtimeDirectory = Join-Path $runtimeRoot $profile.name
    $profile.pnpm = $pnpm
    New-Item -ItemType Directory -Path $profile.runtimeDirectory -Force | Out-Null
    $config = Join-Path $profile.runtimeDirectory 'profile.json'
    $profile | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
    # A hidden PowerShell parent keeps Task Scheduler attached to Node's lifetime.
    $launch = Join-Path $profile.runtimeDirectory 'launch.ps1'
    @'
$ErrorActionPreference = 'Stop'
$config = Join-Path $PSScriptRoot 'profile.json'
$node = Join-Path (Split-Path -Parent $PSScriptRoot) 'node.exe'
$profile = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
$watcher = Join-Path $profile.watcherWorkspace 'scripts/watch-dev-runtime.mjs'
$child = Start-Process -FilePath $node -ArgumentList ('"' + $watcher + '" "' + $config + '"') -WindowStyle Hidden -PassThru
$null = $child.Handle
$child.WaitForExit()
exit $child.ExitCode
'@ | Set-Content -LiteralPath $launch -Encoding UTF8
    $profile.watcherWorkspace = $botWorkspace
    $profile | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launch + '"') -WorkingDirectory $profile.workspace
    $triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $identity), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $profile.task -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
    Write-Output "Installed $($profile.task): pnpm dev at http://127.0.0.1:$($profile.port)"
}
# Replace the old production launch at sign-in so it cannot compete for the profile.
$startupLauncher = Join-Path ([Environment]::GetFolderPath('Startup')) 'Capitalcombot Scheduler.vbs'
@'
Set shell = CreateObject("WScript.Shell")
shell.Run "schtasks.exe /Run /TN ""Capitalcombot Dev Always On""", 0, False
shell.Run "schtasks.exe /Run /TN ""Capitalcomgoldperformancetracker Dev Always On""", 0, False
'@ | Set-Content -LiteralPath $startupLauncher -Encoding Unicode
Write-Output 'Stop and disable the old Capitalcombot Always On task before starting these dev tasks.'
