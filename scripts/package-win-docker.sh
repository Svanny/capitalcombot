#!/usr/bin/env bash
set -euo pipefail

if [[ "${ALLOW_UNSIGNED_PACKAGING:-0}" != "1" ]] && [[ -z "${WIN_CSC_LINK:-${CSC_LINK:-}}" || -z "${WIN_CSC_KEY_PASSWORD:-${CSC_KEY_PASSWORD:-}}" ]]; then
  echo "Refusing unsigned Windows packaging. Set WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD (or CSC_LINK/CSC_KEY_PASSWORD) for a signed build, or ALLOW_UNSIGNED_PACKAGING=1 for a local-only unsigned build." >&2
  exit 1
fi

win_csc_link="${WIN_CSC_LINK:-${CSC_LINK:-}}"
win_csc_key_password="${WIN_CSC_KEY_PASSWORD:-${CSC_KEY_PASSWORD:-}}"

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
  -e WIN_CSC_LINK="${win_csc_link}" \
  -e WIN_CSC_KEY_PASSWORD="${win_csc_key_password}" \
  -e CSC_LINK="${CSC_LINK:-${win_csc_link}}" \
  -e CSC_KEY_PASSWORD="${CSC_KEY_PASSWORD:-${win_csc_key_password}}" \
  -v "${PWD}:/project" \
  -v "${node_modules_volume}:/project/node_modules" \
  -v "${HOME}/.cache/electron:/root/.cache/electron" \
  -v "${HOME}/.cache/electron-builder:/root/.cache/electron-builder" \
  -w /project \
  electronuserland/builder:wine \
  /bin/bash -lc "corepack enable pnpm && pnpm install --frozen-lockfile && pnpm build && pnpm exec electron-builder install-app-deps --platform=win32 --arch=x64 && pnpm exec electron-builder --win nsis --x64 --config electron-builder.yml --publish never"
