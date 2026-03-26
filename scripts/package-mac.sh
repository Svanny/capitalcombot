#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS packaging must run on macOS." >&2
  exit 1
fi

machine_arch="$(uname -m)"
case "${machine_arch}" in
  arm64)
    target_arch="arm64"
    ;;
  x86_64)
    target_arch="x64"
    ;;
  *)
    echo "Unsupported macOS architecture: ${machine_arch}" >&2
    exit 1
    ;;
esac

pnpm build
pnpm exec electron-builder install-app-deps --platform=darwin --arch="${target_arch}"
pnpm exec electron-builder --mac dmg --config electron-builder.yml --publish never --"${target_arch}"
