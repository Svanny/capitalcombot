param(
    [string]$Workspace = (Split-Path -Parent $PSScriptRoot),
    [ValidateRange(2, 600)][int]$HealthTimeoutSeconds = 90,
    [ValidateRange(1, 30)][int]$PollSeconds = 5,
    [ValidateRange(1, 60)][int]$RestartDelaySeconds = 5,
    [ValidateRange(1, 600)][int]$StartupBackoffSeconds = 30,
    [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA 'capitalcombot/runtime')
)
$ErrorActionPreference = 'Stop'
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
$electron = Join-Path $Workspace 'node_modules/electron/dist/electron.exe'
if (!(Test-Path -LiteralPath $electron) -or !(Test-Path -LiteralPath (Join-Path $Workspace 'out/main/index.js'))) {
    throw 'Build the app before starting the scheduled runtime.'
}
$logDirectory = $RuntimeDirectory
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logFile = Join-Path $logDirectory 'supervisor.jsonl'
function Write-RuntimeLog([string]$EventName, [string]$Detail) {
    try {
        if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 1MB) {
            Move-Item -LiteralPath $logFile -Destination "$logFile.1" -Force
        }
        @{ at = [DateTime]::UtcNow.ToString('o'); pid = $PID; event = $EventName; detail = $Detail } |
            ConvertTo-Json -Compress | Add-Content -LiteralPath $logFile
    } catch { Write-Warning "Unable to write supervisor diagnostics: $($_.Exception.Message)" }
}
$hashProvider = [System.Security.Cryptography.SHA256]::Create()
try { $workspaceHash = [BitConverter]::ToString($hashProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($Workspace.ToLowerInvariant()))).Replace('-', '') }
finally { $hashProvider.Dispose() }
$mutex = [Threading.Mutex]::new($false, "Local\capitalcombot-supervisor-$workspaceHash")
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (!$ownsMutex) { exit 0 }
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Remove-Item Env:ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
    $env:CAPITALCOMBOT_SUPERVISED = '1'
    $heartbeatFile = Join-Path $logDirectory "$workspaceHash-heartbeat.json"
    $env:CAPITALCOMBOT_HEARTBEAT_FILE = $heartbeatFile
    function Read-Heartbeat {
        try { return (Get-Content -LiteralPath $heartbeatFile -Raw | ConvertFrom-Json) }
        catch { return $null } # A partial write is retried at the next poll.
    }
    function Find-ExistingApp {
        try {
            $beat = Read-Heartbeat
            if (!$beat -or [int]$beat.pid -le 0) { return $null }
            $candidate = Get-Process -Id $beat.pid -ErrorAction SilentlyContinue
            # Never adopt or terminate a PID belonging to another executable.
            if ($candidate -and $candidate.Path -and $candidate.Path.StartsWith($Workspace + '\', [StringComparison]::OrdinalIgnoreCase) -and
                [IO.Path]::GetFileName($candidate.Path) -eq 'electron.exe') { return $candidate }
            return $null
        } catch { return $null }
    }
    Write-RuntimeLog 'supervisor-started' $Workspace
    while ($true) {
        $started = [DateTime]::UtcNow
        try {
            $appProcess = Find-ExistingApp
            if ($appProcess) { Write-RuntimeLog 'app-adopted' "pid=$($appProcess.Id)" }
            else {
                $appProcess = Start-Process -FilePath $electron -ArgumentList ('"' + $Workspace + '"') -WorkingDirectory $Workspace -WindowStyle Hidden -PassThru
            }
            $null = $appProcess.Handle
            Write-RuntimeLog 'app-started' "pid=$($appProcess.Id)"
            $healthClock = [Diagnostics.Stopwatch]::StartNew()
            $lastBeat = ''
            while (!$appProcess.HasExited) {
                $beat = Read-Heartbeat
                if ($beat -and $beat.pid -eq $appProcess.Id -and $beat.at -ne $lastBeat) {
                    $lastBeat = $beat.at
                    $healthClock.Restart()
                }
                if ($healthClock.Elapsed.TotalSeconds -ge $HealthTimeoutSeconds) {
                    Write-RuntimeLog 'app-unresponsive' "pid=$($appProcess.Id); no heartbeat for $HealthTimeoutSeconds seconds"
                    $appProcess.Kill()
                    $appProcess.WaitForExit()
                    break
                }
                Start-Sleep -Seconds $PollSeconds
                $appProcess.Refresh()
            }
            $exitCode = $appProcess.ExitCode
            Write-RuntimeLog 'app-exited' "pid=$($appProcess.Id); exitCode=$exitCode"
            # Always-on mode recovers clean exits too; stopping requires disabling
            # the Windows task and stopping its supervisor explicitly.
        } catch {
            Write-RuntimeLog 'launch-failed' $_.Exception.Message
        }
        # Back off persistent startup failures; recover isolated crashes promptly.
        $restartDelay = if (([DateTime]::UtcNow - $started).TotalSeconds -lt 30) { [Math]::Max($StartupBackoffSeconds, $RestartDelaySeconds) } else { $RestartDelaySeconds }
        Write-RuntimeLog 'restart-pending' "delaySeconds=$restartDelay"
        Start-Sleep -Seconds $restartDelay
    }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
