import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const profile = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
const child = spawn(profile.pnpm, ['dev'], { cwd: profile.workspace, env: process.env,
  windowsHide: true, stdio: 'inherit' });
child.once('error', () => { process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
