# Core

- Electron desktop trading client for Capital.com; Gold-first workflow but instrument search supports other markets after login.
- Trust boundary: broker credentials, session tokens, API calls, scheduler execution, and state persistence live in Electron main/preload IPC surfaces, not directly in renderer UI.
- Source map:
  - `src/main`: Electron entry, IPC handlers, Capital.com client, scheduler/protection logic, credential/state services.
  - `src/preload`: contextBridge desktop API exposed to renderer.
  - `src/renderer`: React app, tabbed setup/trading/portfolio UI, validation/formatting helpers.
  - `src/shared`: IPC contracts and shared domain types; update this before crossing main/renderer boundaries.
  - `scripts`: packaging helpers; `docs/security`: threat model and audit artifacts.
- Current app surface is three tabs: Setup, Trading, Portfolio. Scheduled orders execute only while desktop app is running.
- Read `mem:tech_stack` for runtime/build pins, `mem:conventions` for architecture/style, `mem:suggested_commands` for local commands, and `mem:task_completion` before handoff.