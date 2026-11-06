import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';

export async function probeRenderer(profile, timeout = 3000) {
  const origin = `http://127.0.0.1:${profile.port}`;
  const response = await fetch(origin, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok || !(await response.text()).includes(`<title>${profile.title}</title>`)) {
    throw new Error('Expected development renderer is unavailable');
  }
  const vite = await fetch(`${origin}/@vite/client`, { signal: AbortSignal.timeout(timeout) });
  if (!vite.ok || !(await vite.text()).includes('createHotContext')) throw new Error('Vite client is unavailable');
}

export async function probeCommand(profile, timeout = 3000) {
  const descriptor = JSON.parse(await readFile(profile.commandFile, 'utf8'));
  if (!Number.isInteger(descriptor.port) || descriptor.port < 1 || descriptor.port > 65535 ||
      !Number.isInteger(descriptor.pid) || descriptor.pid <= 0 || typeof descriptor.token !== 'string') {
    throw new Error('Invalid command descriptor');
  }
  if (profile.protocol === 'http') {
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/health`, {
      signal: AbortSignal.timeout(timeout),
      headers: { authorization: `Bearer ${descriptor.token}` },
    });
    const body = await response.json();
    if (!response.ok || body.ok !== true || body.result?.pid !== descriptor.pid) throw new Error('Command listener is unhealthy');
  } else {
    await new Promise((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: descriptor.port });
      const timer = setTimeout(() => finish(new Error('Command listener timed out')), timeout);
      let payload = '';
      function finish(error) { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(); }
      socket.on('error', finish);
      socket.on('end', () => { if (!payload.includes('\n')) finish(new Error('Command response was incomplete')); });
      socket.on('connect', () => socket.write(`${JSON.stringify({ id: 'watchdog', token: descriptor.token, method: 'runtime.health' })}\n`));
      socket.on('data', chunk => {
        payload += chunk;
        if (payload.length > 8 * 1024 * 1024) return finish(new Error('Command response exceeded its limit'));
        if (!payload.includes('\n')) return;
        try {
          const response = JSON.parse(payload.split('\n')[0]);
          if (response.ok !== true || response.id !== 'watchdog' || response.result?.pid !== descriptor.pid) throw new Error('Command listener is unhealthy');
          finish();
        } catch (error) { finish(error); }
      });
    });
  }
  return descriptor.pid;
}

export async function probeApp(profile) {
  const [, pid] = await Promise.all([probeRenderer(profile), probeCommand(profile)]);
  return pid;
}
