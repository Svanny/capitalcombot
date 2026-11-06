import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function snapshot() {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command',
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','electron.exe','pnpm.exe','cmd.exe') } | ForEach-Object { @{pid=$_.ProcessId;parent=$_.ParentProcessId;name=$_.Name;command=$_.CommandLine;path=$_.ExecutablePath;created=$_.CreationDate.ToUniversalTime().ToString('o')} }) | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
  const value = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function ownedTree(processes, previous) {
  const selected = processes.filter(item => previous.some(old => item.pid === old.pid && item.created === old.created));
  const ids = new Set(selected.map(item => item.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of processes) if (!ids.has(item.pid) && ids.has(item.parent) &&
        Date.parse(item.created) >= Date.parse(selected.find(parent => parent.pid === item.parent).created)) {
      ids.add(item.pid); selected.push(item); changed = true;
    }
  }
  return selected;
}

export async function stopOwned(processes) {
  if (!processes.length) return;
  // Recheck creation times inside the operation to protect against PID reuse.
  await execute('powershell.exe', ['-NoProfile', '-Command',
    "$records = $env:CAPITAL_DEV_STOP_RECORDS | ConvertFrom-Json; foreach ($record in $records) { $current = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$record.pid); if ($current -and $current.CreationDate.ToUniversalTime().ToString('o') -eq $record.created) { Stop-Process -Id $record.pid -ErrorAction SilentlyContinue } }"],
  { windowsHide: true, timeout: 15_000, env: { ...process.env, CAPITAL_DEV_STOP_RECORDS: JSON.stringify([...processes].reverse().map(({ pid, created }) => ({ pid, created }))) } });
}
