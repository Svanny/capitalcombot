# Security Best Practices Audit Report

> Note: refreshed May 13, 2026 after follow-up remediation for Electron sandboxing, IPC validation, signed-packaging gates, state integrity, Capital.com path-segment encoding, pinned dependency manifests, and packaged-renderer CSP.

## Executive summary
This repo now has meaningful security-positive defaults for a local Electron finance client: Capital.com auth stays in the main process, `contextIsolation` and Chromium sandboxing are enabled, `nodeIntegration` is disabled, secrets prefer macOS keychain storage, persisted app state is signed when secure storage is available, IPC payloads are runtime-validated before privileged actions, Capital.com URL path identifiers are encoded, package manifests use pinned reviewed versions instead of `latest`, API-key redaction exists, and the current test suite passes (`75/75`) ([README.md:7-15](README.md), [src/main/index.ts:21-32](src/main/index.ts), [src/main/ipc.ts:99-429](src/main/ipc.ts), [src/main/state/app-store.ts:41-135](src/main/state/app-store.ts), [package.json:20-42](package.json), [src/main/security/credential-store.ts:33-90](src/main/security/credential-store.ts), [src/main/security/redaction.ts:1-12](src/main/security/redaction.ts), [src/main/trading/capital/client.ts:283-457](src/main/trading/capital/client.ts)). The remaining main gaps are optional unsigned local packaging for personal builds and defense-in-depth around high-risk renderer-triggered actions.

## Critical findings
None.

## High findings

None confirmed in the current tree.

## Medium findings

### SBP-001: High-risk renderer-triggered actions still rely on the local desktop trust model
- Severity: Medium
- Impact: A renderer compromise can still invoke privileged preload methods, even though the main process now validates payload shape before acting.
- Location:
  - `src/preload/index.ts:43-78`
  - `src/main/ipc.ts:99-429`
- Evidence:
  - The preload intentionally exposes auth, market, quote, order, position, and schedule operations through `window.capitalApi` ([src/preload/index.ts:43-78](src/preload/index.ts)).
  - The main process validates malformed payloads before privileged actions, but there is no separate user-presence or step-up confirmation gate for calls such as `connectSaved`, `openMarket`, or `updatePositionProtection` ([src/main/ipc.ts:99-429](src/main/ipc.ts)).
- Why it matters:
  - Runtime validation prevents malformed objects and endpoint/path abuse; it does not prove that a syntactically valid high-risk action came from a deliberate user interaction.
- Recommended fix:
  - Add explicit policy or confirmation checks for saved-session reuse and live-trading mutations.
  - Add structured audit logging for privileged IPC calls.
- Mitigation if not fixed immediately:
  - Keep the renderer limited to local bundled content only and avoid remote content/plugin surfaces.

## Low findings

None confirmed in the current tree.

## Positive controls observed
- Capital.com API authentication is handled in the Electron main process, not in renderer code ([README.md:7](README.md), [src/main/ipc.ts:113-136](src/main/ipc.ts)).
- `contextIsolation` and Chromium sandboxing are enabled and `nodeIntegration` is disabled ([src/main/index.ts:21-32](src/main/index.ts)).
- IPC handlers validate renderer-supplied payloads before privileged auth, trading, position, and schedule actions ([src/main/ipc.ts:99-429](src/main/ipc.ts)).
- Persisted app state is stored in a signed envelope when secure state integrity storage is available, with memory fallback otherwise ([src/main/state/app-store.ts:41-135](src/main/state/app-store.ts)).
- Capital.com path identifiers are encoded before being interpolated into endpoint paths ([src/main/trading/capital/client.ts:283-457](src/main/trading/capital/client.ts)).
- Dependency manifests pin reviewed versions and the lockfile records the resolved graph ([package.json:20-42](package.json), [pnpm-lock.yaml](pnpm-lock.yaml)).
- The packaged renderer HTML declares a restrictive CSP for local scripts, styles, images, fonts, and connections ([src/renderer/index.html:1-14](src/renderer/index.html)).
- Credentials default to macOS keychain storage through `keytar`, with session-only in-memory fallback when unavailable ([src/main/security/credential-store.ts:33-90](src/main/security/credential-store.ts)).
- The renderer clears the password field after a successful connect ([src/renderer/src/App.tsx:357-366](src/renderer/src/App.tsx)).
- Error redaction protects surfaced API keys and CAP-style key material before execution-log storage ([src/main/security/redaction.ts:1-12](src/main/security/redaction.ts), [src/main/state/app-store.ts:130-150](src/main/state/app-store.ts)).

## Recommended next fixes
1. Add explicit user-presence or confirmation checks for saved-session reuse and live-trading mutations.
2. Keep local unsigned packaging gated behind `ALLOW_UNSIGNED_PACKAGING=1` and clearly label any unsigned artifacts.
