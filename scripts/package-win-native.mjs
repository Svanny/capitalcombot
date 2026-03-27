#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const hasWindowsSigningConfig =
  Boolean(process.env.WIN_CSC_LINK || process.env.CSC_LINK) &&
  Boolean(process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD);

if (process.env.ALLOW_UNSIGNED_PACKAGING !== "1" && !hasWindowsSigningConfig) {
  console.error(
    "Refusing unsigned Windows packaging. Set WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD (or CSC_LINK/CSC_KEY_PASSWORD) for a signed build, or ALLOW_UNSIGNED_PACKAGING=1 for a local-only unsigned build.",
  );
  process.exit(1);
}

if (process.platform !== "win32") {
  console.error("Native Windows packaging must run on Windows.");
  process.exit(1);
}

run(["build"]);
run(["exec", "electron-builder", "install-app-deps", "--platform=win32", "--arch=x64"]);
run(["exec", "electron-builder", "--win", "nsis", "--x64", "--config", "electron-builder.yml", "--publish", "never"]);

function run(args) {
  const result = spawnSync(pnpmCommand, args, {
    cwd: root,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
