# Capital.com Trading Assistant

Electron desktop app for placing Capital.com market orders, scheduling delayed market orders, and managing open-position protection from a local desktop client. The current workflow is still primarily optimized for Gold discovery and Gold-first trading setups.

## Current Features

- Capital.com demo/live login handled in the Electron main process
- Capital.com market search and selection through the Capital.com API, with Gold as the primary workflow
- Immediate market buy/sell orders
- One-off and repeating scheduled market orders
- Stop-loss and take-profit strategy inputs with live preview
- Open-position close, reverse, and protection update actions
- Local execution log and scheduled-order persistence
- macOS keychain integration through `keytar`, with in-memory fallback when unavailable
- Hot reload in development with `electron-vite`

## Requirements

- macOS for local app development and DMG packaging
- Node.js 25+
- `pnpm`
- A Capital.com account with API access enabled
- Capital.com account identifier, API password, and API key

## Development

Install dependencies:

```bash
pnpm install
```

This repo declares the native packages that must be allowed to run PNPM install scripts, so a fresh install should fetch the Electron binary and build native modules automatically. If an older local install still fails with `Electron failed to install correctly`, run:

```bash
pnpm approve-builds --all
pnpm install
```

Run tests:

```bash
pnpm test
```

Run the desktop app with hot reload:

```bash
pnpm dev
```

`pnpm dev` runs `electron-vite dev --watch`, so renderer edits use Vite HMR and main/preload edits trigger Electron restart or reload during development.

Build the production app bundles:

```bash
pnpm build
```

## Security Docs

- Repo security audit artifacts now live under `docs/security/`.
- Current tracked files:
  - `docs/security/capitalcombot-threat-model.md`
  - `docs/security/security_best_practices_report.md`
  - `docs/security/ownership-sensitive.csv`
  - `docs/security/ownership-map-out/`

## Packaging

Installer artifacts are generated locally and are not committed to the repository. Output goes to `release/`.

Build a signed macOS DMG:

```bash
pnpm package:mac
```

Build a signed Windows NSIS `.exe` from macOS/Linux through Docker/Wine:

```bash
pnpm package:win
```

Build both:

```bash
pnpm package:all
```

### Packaging Notes

- macOS packaging does not require Docker.
- Windows packaging on macOS/Linux requires Docker Desktop running and uses `electronuserland/builder:wine`.
- The packaging scripts rebuild Electron-native dependencies such as `keytar` for the target platform before bundling so saved-credential support remains available in packaged apps.
- If Windows cross-builds fail on a specific machine or CI image because of native-module tooling, use a Windows build host.
- Packaging now refuses unsigned release builds by default.
- For signed packaging, provide platform signing credentials through the standard Electron Builder environment variables:
  - macOS: `CSC_LINK` and `CSC_KEY_PASSWORD`
  - Windows: `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` (or `CSC_LINK` / `CSC_KEY_PASSWORD`)
- For local-only testing builds, set `ALLOW_UNSIGNED_PACKAGING=1` to opt into an unsigned artifact intentionally.

## Runtime Notes

- Scheduled orders execute only while the desktop app is running.
- Non-secret local UI state is persisted with `electron-store` only when secure state-integrity storage is available.
- Secrets are kept in the macOS keychain when `keytar` is available.
- If `keytar` is unavailable, the app falls back to in-memory credentials and session-only app state for the current session only.

## License

Copyright © 2026 Svanny.

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).
