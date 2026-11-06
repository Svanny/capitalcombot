import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { probeCommand, probeRenderer } from './health.mjs';
import { needsRestart } from './policy.mjs';
import { ownedTree } from './windows-processes.mjs';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function descriptor(port: number) {
  const directory = await mkdtemp(join(tmpdir(), 'dev-watchdog-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'command.json');
  await writeFile(path, JSON.stringify({ port, pid: process.pid, token: 'test-token' }));
  return path;
}
async function listen(server: ReturnType<typeof createServer> | ReturnType<typeof createTcpServer>) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  return (server.address() as { port: number }).port;
}
it('requires both the expected renderer identity and a live Vite client', async () => {
  let viteHealthy = true;
  const port = await listen(createServer((request, response) => {
    response.end(request.url === '/@vite/client' ? (viteHealthy ? 'createHotContext' : 'not vite') : '<title>Test App</title>');
  }));
  await expect(probeRenderer({ port, title: 'Test App' })).resolves.toBeUndefined();
  await expect(probeRenderer({ port, title: 'Different App' })).rejects.toThrow();
  viteHealthy = false;
  await expect(probeRenderer({ port, title: 'Test App' })).rejects.toThrow('Vite');
});
it('probes the TCP main process with an authenticated read-only health request', async () => {
  const port = await listen(createTcpServer(socket => socket.on('data', data => {
    const request = JSON.parse(String(data));
    expect(request.method).toBe('runtime.health');
    expect(request.token).toBe('test-token');
    socket.end(JSON.stringify({ id: request.id, ok: true, result: { pid: process.pid } }) + '\n');
  })));
  await expect(probeCommand({ protocol: 'tcp', commandFile: await descriptor(port) })).resolves.toBe(process.pid);
});
it('times out an unresponsive command listener', async () => {
  const port = await listen(createTcpServer(socket => socket.resume()));
  await expect(probeCommand({ protocol: 'tcp', commandFile: await descriptor(port) }, 40)).rejects.toThrow('timed out');
});
it('probes the tracker HTTP listener without performing a data mutation', async () => {
  const port = await listen(createServer((request, response) => {
    expect(request.headers.authorization).toBe('Bearer test-token');
    expect(request.method).toBe('GET');
    expect(request.url).toBe('/health');
    response.end(JSON.stringify({ ok: true, result: { pid: process.pid } }));
  }));
  await expect(probeCommand({ protocol: 'http', commandFile: await descriptor(port) })).resolves.toBe(process.pid);
});
it('tolerates reloads, but recovers repeated failures and startup timeouts', () => {
  expect(needsRestart({ healthy: false, everHealthy: true, elapsed: 10, failures: 2 })).toBe(false);
  expect(needsRestart({ healthy: false, everHealthy: true, elapsed: 10, failures: 3 })).toBe(true);
  expect(needsRestart({ healthy: false, everHealthy: false, elapsed: 299999, failures: 50 })).toBe(false);
  expect(needsRestart({ healthy: false, everHealthy: false, elapsed: 300000, failures: 50 })).toBe(true);
  expect(needsRestart({ healthy: true, everHealthy: true, elapsed: 999999, failures: 3 })).toBe(false);
});
it('tracks orphaned descendants without adopting reused PIDs or another project', () => {
  const old = '2026-11-06T01:00:00Z';
  const current = '2026-11-06T02:00:00Z';
  const newer = '2026-11-06T03:00:00Z';
  const processes = [{ pid: 1, parent: 0, created: newer }, { pid: 2, parent: 0, created: current },
    { pid: 3, parent: 2, created: newer }, { pid: 4, parent: 0, created: newer },
    { pid: 5, parent: 2, created: old }];
  expect(ownedTree(processes, [{ pid: 1, created: old }, { pid: 2, created: current }]).map(item => item.pid)).toEqual([2, 3]);
});
