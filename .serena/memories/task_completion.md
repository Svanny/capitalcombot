# Task Completion

- For ordinary code changes, run `pnpm test` and `pnpm build` before handoff unless the change is docs/config-only or the user constrained scope.
- For targeted risky areas, also run the closest focused Vitest file first, then the full suite when practical.
- For IPC/shared contract changes, verify all affected layers: `src/shared`, `src/main/ipc.ts`, `src/preload/index.ts`, and renderer call sites/tests.
- For packaging changes, run `pnpm build` plus the relevant platform package command when the host OS supports it; note unsupported platform commands explicitly.
- For Serena maintenance after memory/project config edits, run `serena memories check`, `serena project index`, and `serena project health-check` from the project root.
- Do not leave debug logging, temporary credentials, generated release artifacts, or stale scheduler/test state in commits unless intentionally requested.