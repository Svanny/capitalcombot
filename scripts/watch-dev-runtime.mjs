import { readFile, mkdir, writeFile, appendFile, stat, rename } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join, delimiter } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { probeApp } from './dev-runtime/health.mjs';
import { snapshot, ownedTree, stopOwned } from './dev-runtime/windows-processes.mjs';
import { needsRestart } from './dev-runtime/policy.mjs';

const profile = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
await mkdir(profile.runtimeDirectory, { recursive: true });
const stateFile = join(profile.runtimeDirectory, 'state.json');
const logFile = join(profile.runtimeDirectory, 'watchdog.jsonl');
const outputFile = join(profile.runtimeDirectory, 'dev.log');
let status = { app: profile.name, healthy: false, watcherPid: process.pid };
async function log(event, detail) {
  try {
    if ((await stat(logFile).catch(() => ({ size: 0 }))).size > 1_048_576) await rename(logFile, `${logFile}.1`);
    await appendFile(logFile, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, detail })}\n`);
  } catch { /* Diagnostics must not stop recovery. */ }
}
// Besides preventing duplicate watchers, this offers a token-free health endpoint.
const listener = createServer((_request, response) => {
  response.writeHead(status.healthy ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify(status));
});
await new Promise((resolve, reject) => {
  listener.once('error', error => error.code === 'EADDRINUSE' ? process.exit(0) : reject(error));
  listener.listen(profile.watchPort, '127.0.0.1', resolve);
});
let records = [];
let savedHealthy = false;
try {
  const saved = JSON.parse(await readFile(stateFile, 'utf8'));
  records = saved.processes ?? [];
  savedHealthy = saved.status?.healthy === true;
} catch {}
let started = performance.now();
let everHealthy = savedHealthy;
let failures = 0;
let launched = false;
let launchExited = false;
await log('watcher-started', profile.workspace);

for (;;) {
  try {
    let processes = await snapshot();
    records = ownedTree(processes, records);
    let appPid;
    try { appPid = await probeApp(profile); } catch { /* Retry before restarting. */ }
    const healthy = Number.isInteger(appPid);
    if (healthy) {
      failures = 0; everHealthy = true;
      // Adopt manually started pnpm dev trees after a watcher restart. Stop at
      // the project boundary, never adopt an interactive shell or another repo.
      const app = processes.find(item => item.pid === appPid && item.path?.toLowerCase().startsWith(profile.workspace.toLowerCase() + '\\'));
      if (app) {
        let root = app;
        for (;;) {
          const parent = processes.find(item => item.pid === root.parent);
          if (!parent || parent.pid === process.pid || !['node.exe', 'pnpm.exe'].includes(parent.name) ||
              !parent.command?.toLowerCase().includes(profile.workspace.toLowerCase())) break;
          root = parent;
        }
        records = ownedTree(processes, [...records, root]);
      }
    } else failures++;
    const transition = status.healthy !== healthy;
    status = { app: profile.name, healthy, watcherPid: process.pid, appPid, port: profile.port, checkedAt: new Date().toISOString() };
    if (transition) await log(healthy ? 'healthy' : 'unhealthy');
    if ((!records.length && !launched) || needsRestart({ healthy, everHealthy: everHealthy || launchExited, elapsed: performance.now() - started, failures })) {
      if (!healthy) {
        await log('restarting-dev', `ownedProcesses=${records.length}`);
        await stopOwned(records);
        // Never kill an unrelated occupant of the configured port. strictPort
        // makes that conflict visible in dev.log instead of changing origins.
        const env = { ...process.env, ...profile.environment, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
          CAPITALCOMBOT_SUPERVISED: '1' };
        delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
        delete env.CAPITALCOMBOT_HEARTBEAT_FILE;
        if ((await stat(outputFile).catch(() => ({ size: 0 }))).size > 5_242_880) await rename(outputFile, `${outputFile}.1`);
        const output = openSync(outputFile, 'a');
        const child = spawn(process.execPath, [fileURLToPath(new URL('./dev-runtime/run-dev-child.mjs', import.meta.url)), process.argv[2]], { cwd: profile.workspace, env, windowsHide: true,
          stdio: ['ignore', output, output] });
        closeSync(output);
        child.on('error', () => void log('launch-failed'));
        launchExited = false;
        child.on('exit', (code, signal) => {
          launchExited = true;
          void log('dev-exited', `code=${code}; signal=${signal}`);
        });
        // Let the launcher register before capturing its descendants.
        await new Promise(resolve => setTimeout(resolve, 1000));
        processes = await snapshot();
        records = ownedTree(processes, processes.filter(item => item.pid === child.pid));
        started = performance.now(); failures = 0; everHealthy = false;
        launched = true;
        await log('dev-started', `pid=${child.pid}`);
      }
    }
    await writeFile(stateFile, JSON.stringify({ processes: records.map(({ pid, parent, created }) => ({ pid, parent, created })), status }));
  } catch {
    await log('watcher-check-failed');
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
