# Capital Gold Trader

Electron desktop app for placing Capital.com Gold market orders, monitoring open positions, and scheduling delayed orders while the app is running.

## Features

- Demo-first Capital.com login flow handled in the Electron main process
- macOS keychain storage for Capital.com credentials via `keytar`
- Gold market search and selection through the Capital.com `/markets` API
- Market buy/sell order ticket with optional scheduled order execution
- Open positions table with close, reverse, and protection actions
- Restored scheduled orders and execution log persisted locally
- Hot reload in development for renderer, preload, and main-process changes

## Requirements

- macOS
- Node.js 25+
- A Capital.com account with API access enabled
- Capital.com API key, identifier, and password

## Development

```bash
pnpm install
pnpm test
pnpm build
pnpm dev
```

`pnpm dev` runs `electron-vite dev --watch`, so renderer changes use Vite HMR and main/preload changes trigger an Electron restart or window reload during development. Use `pnpm dev:plain` only if you explicitly want the non-watch dev server.

## Notes

- Scheduled orders are best-effort and only execute while the Electron process is running.
- The app stores only non-secret UI state in `electron-store`; secrets are kept in the macOS keychain.
- The included tests cover the Capital.com client request mapping, scheduler behavior, IPC handlers, and renderer-side order validation.
