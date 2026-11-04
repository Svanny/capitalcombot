import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronViteCli = resolve(root, "node_modules", "electron-vite", "bin", "electron-vite.js");

// Some Node/Electron tooling sets this flag globally. Electron interprets it
// as "run as Node", which makes electron-vite launch the wrong runtime (and
// commonly surfaces as an Electron runtime mismatch). It must not be passed
// to the desktop app, while all other environment settings remain intact.
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [electronViteCli, ...process.argv.slice(2)], {
  cwd: root,
  env: environment,
  stdio: "inherit",
  windowsHide: false,
});

child.once("error", (error) => {
  console.error(`Unable to start electron-vite: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
