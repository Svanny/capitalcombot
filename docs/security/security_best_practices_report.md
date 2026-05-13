# Security Best Practices Audit Report

> Note: refreshed May 13, 2026 after follow-up remediation for Electron sandboxing, IPC validation, main-process user-presence confirmation, signed-packaging gates, state integrity, Capital.com path-segment encoding, pinned dependency manifests, and packaged-renderer CSP.

## Executive summary
This repo now has meaningful security-positive defaults for a local Electron finance client: Capital.com auth stays in the main process, `contextIsolation` and Chromium sandboxing are enabled, `nodeIntegration` is disabled, secrets prefer macOS keychain storage, persisted app state is signed when secure storage is available, IPC payloads are runtime-validated before privileged actions, high-risk trading/auth actions require native main-process user confirmation, Capital.com URL path identifiers are encoded, package manifests use pinned reviewed versions instead of `latest`, API-key redaction exists, and the current test suite passes (`77/77`) ([README.md:7-15](README.md), [src/main/index.ts:21-32](src/main/index.ts), [src/main/ipc.ts:64-379](src/main/ipc.ts), [src/main/state/app-store.ts:41-135](src/main/state/app-store.ts), [package.json:20-42](package.json), [src/main/security/credential-store.ts:33-90](src/main/security/credential-store.ts), [src/main/security/redaction.ts:1-12](src/main/security/redaction.ts), [src/main/trading/capital/client.ts:283-457](src/main/trading/capital/client.ts)). The remaining main gap is optional unsigned local packaging for personal builds.

## Critical findings
None.

## High findings

None confirmed in the current tree.

## Medium findings

None confirmed in the current tree.

## Low findings

None confirmed in the current tree.

## Positive controls observed
- Capital.com API authentication is handled in the Electron main process, not in renderer code ([README.md:7](README.md), [src/main/ipc.ts:113-136](src/main/ipc.ts)).
- `contextIsolation` and Chromium sandboxing are enabled and `nodeIntegration` is disabled ([src/main/index.ts:21-32](src/main/index.ts)).
- IPC handlers validate renderer-supplied payloads before privileged auth, trading, position, and schedule actions ([src/main/ipc.ts:99-429](src/main/ipc.ts)).
- High-risk saved-session, order, position, and schedule mutations require native main-process user confirmation before privileged services are called ([src/main/ipc.ts:64-379](src/main/ipc.ts)).
- Persisted app state is stored in a signed envelope when secure state integrity storage is available, with memory fallback otherwise ([src/main/state/app-store.ts:41-135](src/main/state/app-store.ts)).
- Capital.com path identifiers are encoded before being interpolated into endpoint paths ([src/main/trading/capital/client.ts:283-457](src/main/trading/capital/client.ts)).
- Dependency manifests pin reviewed versions and the lockfile records the resolved graph ([package.json:20-42](package.json), [pnpm-lock.yaml](pnpm-lock.yaml)).
- The packaged renderer HTML declares a restrictive CSP for local scripts, styles, images, fonts, and connections ([src/renderer/index.html:1-14](src/renderer/index.html)).
- Credentials default to macOS keychain storage through `keytar`, with session-only in-memory fallback when unavailable ([src/main/security/credential-store.ts:33-90](src/main/security/credential-store.ts)).
- The renderer clears the password field after a successful connect ([src/renderer/src/App.tsx:357-366](src/renderer/src/App.tsx)).
- Error redaction protects surfaced API keys and CAP-style key material before execution-log storage ([src/main/security/redaction.ts:1-12](src/main/security/redaction.ts), [src/main/state/app-store.ts:130-150](src/main/state/app-store.ts)).

## Recommended next fixes
1. Keep local unsigned packaging gated behind `ALLOW_UNSIGNED_PACKAGING=1` and clearly label any unsigned artifacts.
