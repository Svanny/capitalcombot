# Suggested Commands

- Install deps: `pnpm install`.
- Dev app: `pnpm dev`; plain electron-vite dev without watch: `pnpm dev:plain`.
- Tests: `pnpm test`; watch mode: `pnpm test:watch`.
- Build/typecheck: `pnpm build` (`tsc --noEmit && electron-vite build`).
- Packaging: `pnpm package:win:native` on Windows; `pnpm package:linux`, `pnpm package:mac`, `pnpm package:win`, `pnpm package:all` where supported.
- If Electron install/build scripts are blocked: `pnpm approve-builds --all`, then `pnpm install`.
- Serena setup/verification from repo root: `serena memories check`, `serena project index`, `serena project health-check`.
- Windows shell utilities: prefer `rg --files` and `rg` for file/text search; use PowerShell path quoting with `-LiteralPath` for paths that may contain spaces.