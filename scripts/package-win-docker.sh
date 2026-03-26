#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Desktop is required for Windows packaging on macOS/Linux." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

mkdir -p "${HOME}/.cache/electron" "${HOME}/.cache/electron-builder"

project_name="${PWD##*/}"
node_modules_volume="${project_name}-node-modules"

docker run --rm -t \
  -e ELECTRON_CACHE=/root/.cache/electron \
  -e ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
  -v "${PWD}:/project" \
  -v "${node_modules_volume}:/project/node_modules" \
  -v "${HOME}/.cache/electron:/root/.cache/electron" \
  -v "${HOME}/.cache/electron-builder:/root/.cache/electron-builder" \
  -w /project \
  electronuserland/builder:wine \
  /bin/bash -lc "corepack enable pnpm && pnpm install --frozen-lockfile && pnpm build && pnpm exec electron-builder install-app-deps --platform=win32 --arch=x64 && pnpm exec electron-builder --win nsis --x64 --config electron-builder.yml --publish never"
