# Conventions

- Keep broker/session/secret work in main process. Renderer talks through typed preload/IPC contracts; do not expose Capital.com credentials or raw privileged APIs to React components.
- Update `src/shared/ipc.ts` and `src/shared/types.ts` deliberately when changing main/renderer contracts; keep main handlers and renderer desktop API usage aligned.
- Prefer small domain modules over god files: trading client/protection/scheduler under `src/main/trading`, security under `src/main/security`, state under `src/main/state`, renderer features under `src/renderer/src/features/<area>`.
- UI is intentionally compact desktop tooling, not a marketing surface. Setup/Trading/Portfolio are the primary workflow boundaries.
- Secure persistence is conditional: credentials use keychain when `keytar` is available; memory-only fallback is session-scoped. Non-secret state persistence depends on state-integrity storage.
- Tests live beside implementation (`*.test.ts`, `*.test.tsx`); update focused tests for behavior changes and shared-contract tests when IPC or shared types change.