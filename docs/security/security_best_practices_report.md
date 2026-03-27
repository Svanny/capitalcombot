# Security Best Practices Audit Report

> Note: this report captures the audit baseline from March 27, 2026 before the follow-up remediation changes in the current working tree.

## Executive summary
This repo already has some meaningful security-positive defaults for a local Electron finance client: Capital.com auth stays in the main process, `contextIsolation` is enabled, `nodeIntegration` is disabled, secrets prefer macOS keychain storage, API-key redaction exists, and the current test suite passes (`49/49`) ([README.md:7-15](README.md), [src/main/index.ts:50-55](src/main/index.ts), [src/main/services/credential-store.ts:33-90](src/main/services/credential-store.ts), [src/main/services/redaction.ts:1-12](src/main/services/redaction.ts)). The main gaps are around Electron desktop hardening, main-process trust of renderer-supplied inputs, local integrity of persisted schedules/state, unsigned distribution for a finance-sensitive app, and dependency/governance discipline for privileged build/runtime packages.

## Critical findings
None.

## High findings

### SBP-001: Electron sandbox is disabled while a broad privileged preload API remains exposed
- Severity: High
- Impact: A renderer compromise becomes materially more dangerous because the app keeps a large trading/auth API exposed to the renderer while disabling Chromium sandboxing for the window that hosts it.
- Location:
  - `src/main/index.ts:41-55`
  - `src/preload/index.ts:43-78`
- Evidence:
  - `BrowserWindow` is created with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: false` ([src/main/index.ts:50-55](src/main/index.ts)).
  - The preload exposes auth, market, quote, order, position, and schedule operations through `window.capitalApi` ([src/preload/index.ts:43-78](src/preload/index.ts)).
- Why it matters:
  - In an Electron trading app, renderer compromise should not directly imply privileged broker actions. Here, the preload surface is intentionally broad because the UI needs it, so disabling sandboxing increases the blast radius if any renderer compromise or future remote-content path appears.
- Recommended fix:
  - Enable `sandbox: true` unless a specific incompatible dependency blocks it.
  - Reduce preload exposure to the minimum required surface.
  - Pair the preload API with runtime validation and explicit policy checks in the main process.
- Mitigation if not fixed immediately:
  - Keep the renderer limited to local bundled content only.
  - Avoid any remote content, plugin system, or HTML injection path until sandboxing is restored.

### SBP-002: IPC handlers trust renderer-supplied payloads without centralized runtime validation
- Severity: High
- Impact: If the renderer is compromised or buggy, privileged order, schedule, credential, and protection flows can be driven with payloads that are only type-checked at compile time, not schema-checked at the security boundary.
- Location:
  - `src/main/ipc.ts:61-97`
  - `src/main/ipc.ts:113-178`
  - `src/main/ipc.ts:236-362`
- Evidence:
  - `ipcMain.handle(...)` directly forwards typed payloads into privileged handlers ([src/main/ipc.ts:61-97](src/main/ipc.ts)).
  - `openMarket`, `updatePositionProtection`, `closePosition`, `reversePosition`, and auth handlers do not apply an independent runtime schema before using values ([src/main/ipc.ts:236-362](src/main/ipc.ts)).
  - Renderer validation exists, but only inside UI code and therefore cannot be treated as a trusted security gate ([src/renderer/src/lib/validation.ts:28-105](src/renderer/src/lib/validation.ts)).
- Why it matters:
  - In Electron, the renderer is a lower-trust zone than the main process even when content is local. A compromised renderer can call `connectSaved`, place orders, or mutate protection settings through the preload surface. TypeScript types do not protect `ipcMain` at runtime.
- Recommended fix:
  - Add per-channel runtime schemas for every IPC handler.
  - Reject unknown fields and normalize values centrally before business logic runs.
  - Consider explicit policy checks for high-risk operations such as `connectSaved`, `openMarket`, and `updatePositionProtection`.
- Mitigation if not fixed immediately:
  - Add structured audit logging for every privileged IPC call so unexpected actions can be detected quickly.

### SBP-003: Release packaging is intentionally unsigned and not notarized for a finance-sensitive desktop app
- Severity: High
- Impact: Users can be tricked into installing a trojanized build that captures credentials or issues trades from the privileged main process.
- Location:
  - `README.md:57-81`
  - `electron-builder.yml:21-39`
  - `scripts/package-win-docker.sh:19-28`
- Evidence:
  - The README explicitly states the macOS DMG and Windows NSIS installers are unsigned, and that installers in this pass are unsigned and not notarized ([README.md:57-81](README.md)).
  - `electron-builder.yml` sets `identity: null` and `dmg.sign: false` ([electron-builder.yml:21-29](electron-builder.yml)).
  - Windows packaging happens in a generic Docker/Wine builder image without any visible artifact-signing step ([scripts/package-win-docker.sh:19-28](scripts/package-win-docker.sh)).
- Why it matters:
  - This is not a generic desktop utility. It handles broker credentials and can place live orders. Unsigned finance tooling creates a direct path from artifact tampering to financial loss.
- Recommended fix:
  - Code sign and notarize macOS releases.
  - Add Authenticode signing for Windows installers.
  - Publish hashes and release provenance from a trusted release pipeline rather than distributing locally built artifacts informally.
- Mitigation if not fixed immediately:
  - Treat builds as personal-use only.
  - Do not distribute installers through channels where authenticity cannot be independently verified.

## Medium findings

### SBP-004: Integrity-critical schedule and execution state is persisted without tamper protection
- Severity: Medium
- Impact: Local filesystem tampering can alter queued order details or mislead the operator about scheduled/executed activity, which matters more because the same app can connect to live accounts.
- Location:
  - `src/main/services/app-store.ts:11-17`
  - `src/main/services/app-store.ts:72-100`
  - `src/main/services/app-store.ts:153-173`
  - `src/main/services/scheduler.ts:44-52`
  - `src/main/services/scheduler.ts:99-150`
  - `src/main/services/scheduler.ts:162-252`
- Evidence:
  - `electron-store` persists `selectedMarket`, `schedules`, `executionLog`, and `savedProfile` ([src/main/services/app-store.ts:11-17](src/main/services/app-store.ts), [src/main/services/app-store.ts:72-76](src/main/services/app-store.ts)).
  - Schedule validation on read is shallow and only checks a subset of top-level fields ([src/main/services/app-store.ts:153-173](src/main/services/app-store.ts)).
  - `scheduler.restore()` re-arms persisted `scheduled` jobs on startup ([src/main/services/scheduler.ts:44-52](src/main/services/scheduler.ts), [src/main/services/scheduler.ts:99-150](src/main/services/scheduler.ts)).
- Why it matters:
  - Credentials are better protected in keychain, but order integrity is still sensitive. A local attacker or malware that can alter persisted schedule state can prepare unintended trades that later execute once the user reconnects.
- Recommended fix:
  - Add integrity protection or authenticated serialization for persisted schedules.
  - Re-validate full nested schedule/protection payloads in the main process before restore and before execution.
  - Consider requiring explicit user confirmation for restored pending jobs after app restart.
- Mitigation if not fixed immediately:
  - Treat the app-state file as sensitive operational state.
  - Surface a prominent “restored pending schedules” review step on startup.

### SBP-005: Dependency manifests use `latest` across runtime and build tooling
- Severity: Medium
- Impact: Privileged Electron/runtime/package tooling can drift to unreviewed upstream versions, which weakens supply-chain review and can introduce behavior changes into finance-sensitive builds.
- Location:
  - `package.json:20-42`
  - `scripts/package-win-docker.sh:28`
- Evidence:
  - All listed dependencies and devDependencies are declared as `latest` ([package.json:20-42](package.json)).
  - The Windows packaging script installs dependencies before building, relying on the lockfile to constrain drift ([scripts/package-win-docker.sh:28](scripts/package-win-docker.sh)).
- Why it matters:
  - The lockfile mitigates this for the current checked-in state, but `latest` still reduces review clarity and makes future lockfile refreshes less intentional than they should be for Electron, `keytar`, build tooling, and security-sensitive desktop runtime packages.
- Recommended fix:
  - Replace `latest` with reviewed semver ranges or exact versions.
  - Treat lockfile updates as explicit review events.
  - Consider dependency policy checks for Electron, preload/runtime-facing packages, and packaging tools.
- Mitigation if not fixed immediately:
  - Keep using frozen-lockfile installs in build contexts.
  - Review every lockfile change as if it were a code change.

## Low findings

### SBP-006: No visible CSP or equivalent renderer content policy is present in the local HTML shell
- Severity: Low
- Impact: This does not create a demonstrated exploit path by itself in the current local-content design, but it removes a defense-in-depth layer if the renderer ever grows richer HTML handling or remote content paths.
- Location:
  - `src/renderer/index.html:1-15`
- Evidence:
  - The HTML shell contains the root node and module script but no visible CSP meta tag or equivalent local content policy ([src/renderer/index.html:1-15](src/renderer/index.html)).
- Why it matters:
  - Because the app currently loads local bundled content, this is not the top risk. But once paired with the broad preload API and disabled sandbox, losing defense in depth on renderer content becomes more consequential.
- Recommended fix:
  - Add a conservative CSP for the packaged renderer if compatible with the Electron/Vite build.
  - Keep any future HTML-rendering features behind explicit sanitization review.
- False-positive note:
  - A stronger policy could exist elsewhere in the final packaged runtime; it is not visible in this repo.

## Positive controls observed
- Capital.com API authentication is handled in the Electron main process, not in renderer code ([README.md:7](README.md), [src/main/ipc.ts:113-136](src/main/ipc.ts)).
- `contextIsolation` is enabled and `nodeIntegration` is disabled ([src/main/index.ts:50-55](src/main/index.ts)).
- Credentials default to macOS keychain storage through `keytar`, with session-only in-memory fallback when unavailable ([src/main/services/credential-store.ts:33-90](src/main/services/credential-store.ts)).
- The renderer clears the password field after a successful connect ([src/renderer/src/App.tsx:357-366](src/renderer/src/App.tsx)).
- Error redaction protects surfaced API keys and CAP-style key material before execution-log storage ([src/main/services/redaction.ts:1-12](src/main/services/redaction.ts), [src/main/services/app-store.ts:130-150](src/main/services/app-store.ts)).

## Recommended next fixes
1. Re-enable Electron sandboxing and add runtime IPC schemas before expanding any renderer capabilities.
2. Treat restored schedules as integrity-critical state: harden serialization, restore validation, and startup confirmation.
3. Establish signed/notarized release packaging before broader distribution or routine live-account use.
4. Replace `latest` dependency declarations with reviewed versions/ranges and tighten release/dependency review.
