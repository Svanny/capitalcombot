# Integration check using a Node fixture, never the broker or the live app state.
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $env:TEMP ('capitalcombot-watchdog-test-' + [guid]::NewGuid().ToString('N'))
$runtimeDirectory = Join-Path $testRoot 'runtime'
$supervisorScript = Join-Path $PSScriptRoot 'run-scheduled-app.ps1'
New-Item -ItemType Directory -Path (Join-Path $testRoot 'node_modules/electron/dist'),(Join-Path $testRoot 'out/main') -Force | Out-Null
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $testRoot 'node_modules/electron/dist/electron.exe')
Set-Content -LiteralPath (Join-Path $testRoot 'out/main/index.js') -Value '// fixture'
@'
const fs = require('node:fs');
const path = require('node:path');
const counter = path.join(__dirname, 'launch-count.txt');
const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1;
fs.writeFileSync(counter, String(count));
const heartbeat = () => fs.writeFileSync(process.env.CAPITALCOMBOT_HEARTBEAT_FILE, JSON.stringify({pid:process.pid, at:new Date().toISOString()}));
heartbeat();
if (count === 1) setTimeout(() => process.exit(0), 200);
else if (count === 2) setInterval(() => {}, 100); // Alive, but main loop health stopped.
else setInterval(heartbeat, 100);
'@ | Set-Content -LiteralPath (Join-Path $testRoot 'index.js')
function Start-TestSupervisor {
    Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -File "' + $supervisorScript + '" -Workspace "' + $testRoot + '" -RuntimeDirectory "' + $runtimeDirectory + '" -HealthTimeoutSeconds 2 -PollSeconds 1 -RestartDelaySeconds 1 -StartupBackoffSeconds 1') -WindowStyle Hidden -PassThru
}
function Assert-Condition([bool]$Condition, [string]$Message) {
    if (!$Condition) { throw $Message }
    Write-Output "PASS: $Message"
}
$supervisor = $null
$fixtureProcess = $null
try {
    $supervisor = Start-TestSupervisor
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    $counterFile = Join-Path $testRoot 'launch-count.txt'
    do {
        Start-Sleep -Milliseconds 200
        $count = if (Test-Path -LiteralPath $counterFile) { [int](Get-Content -LiteralPath $counterFile) } else { 0 }
    } while ($count -lt 3 -and [DateTime]::UtcNow -lt $deadline)
    Assert-Condition ($count -eq 3) 'Clean exit and missing heartbeat both recovered'
    $log = Get-Content -LiteralPath (Join-Path $runtimeDirectory 'supervisor.jsonl') | ConvertFrom-Json
    Assert-Condition ($null -ne ($log | Where-Object event -eq 'app-unresponsive')) 'Hung process detected in supervisor log'
    $heartbeatFile = Get-ChildItem -LiteralPath $runtimeDirectory -Filter '*heartbeat.json' | Select-Object -First 1
    $beat = Get-Content -LiteralPath $heartbeatFile.FullName -Raw | ConvertFrom-Json
    $fixtureProcess = Get-Process -Id $beat.pid
    $duplicate = Start-TestSupervisor
    Assert-Condition ($duplicate.WaitForExit(3000)) 'Duplicate supervisor exits without starting another app'
    Stop-Process -Id $supervisor.Id
    $supervisor.WaitForExit()
    $supervisor = Start-TestSupervisor
    Start-Sleep -Seconds 3
    Assert-Condition ([int](Get-Content -LiteralPath $counterFile) -eq 3) 'Replacement supervisor adopts the healthy app'
    $log = Get-Content -LiteralPath (Join-Path $runtimeDirectory 'supervisor.jsonl') | ConvertFrom-Json
    Assert-Condition ($null -ne ($log | Where-Object event -eq 'app-adopted')) 'App adoption recorded'
} finally {
    if ($supervisor -and !$supervisor.HasExited) { Stop-Process -Id $supervisor.Id }
    if ($fixtureProcess -and !$fixtureProcess.HasExited) { Stop-Process -Id $fixtureProcess.Id }
    Write-Output "Test evidence: $testRoot"
}
