# Security Best Practices Audit Report

> Note: refreshed May 13, 2026 after follow-up remediation for Electron sandboxing, IPC validation, signed-packaging gates, state integrity, and Capital.com path-segment encoding.

## Executive summary
This repo now has meaningful security-positive defaults for a local Electron finance client: Capital.com auth stays in the main process, `contextIsolation` and Chromium sandboxing are enabled, `nodeIntegration` is disabled, secrets prefer macOS keychain storage, persisted app state is signed when secure storage is available, IPC payloads are runtime-validated before privileged actions, Capital.com URL path identifiers are encoded, API-key redaction exists, and the current test suite passes (`75/75`) ([README.md:7-15](README.md), [src/main/index.ts:21-32](src/main/index.ts), [src/main/ipc.ts:99-429](src/main/ipc.ts), [src/main/state/app-store.ts:41-135](src/main/state/app-store.ts), [src/main/security/credential-store.ts:33-90](src/main/security/credential-store.ts), [src/main/security/redaction.ts:1-12](src/main/security/redaction.ts), [src/main/trading/capital/client.ts:283-457](src/main/trading/capital/client.ts)). The remaining main gaps are dependency/governance discipline for privileged build/runtime packages, optional unsigned local packaging for personal builds, and defense-in-depth around high-risk renderer-triggered actions.

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

### SBP-002: Dependency manifests use `latest` across runtime and build tooling
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

### SBP-003: No visible CSP or equivalent renderer content policy is present in the local HTML shell
- Severity: Low
- Impact: This does not create a demonstrated exploit path by itself in the current local-content design, but it removes a defense-in-depth layer if the renderer ever grows richer HTML handling or remote content paths.
- Location:
  - `src/renderer/index.html:1-15`
- Evidence:
  - The HTML shell contains the root node and module script but no visible CSP meta tag or equivalent local content policy ([src/renderer/index.html:1-15](src/renderer/index.html)).
- Why it matters:
  - Because the app currently loads local bundled content, this is not the top risk. A conservative policy would still add useful defense in depth around the broad preload API.
- Recommended fix:
  - Add a conservative CSP for the packaged renderer if compatible with the Electron/Vite build.
  - Keep any future HTML-rendering features behind explicit sanitization review.
- False-positive note:
  - A stronger policy could exist elsewhere in the final packaged runtime; it is not visible in this repo.

## Positive controls observed
- Capital.com API authentication is handled in the Electron main process, not in renderer code ([README.md:7](README.md), [src/main/ipc.ts:113-136](src/main/ipc.ts)).
- `contextIsolation` and Chromium sandboxing are enabled and `nodeIntegration` is disabled ([src/main/index.ts:21-32](src/main/index.ts)).
- IPC handlers validate renderer-supplied payloads before privileged auth, trading, position, and schedule actions ([src/main/ipc.ts:99-429](src/main/ipc.ts)).
- Persisted app state is stored in a signed envelope when secure state integrity storage is available, with memory fallback otherwise ([src/main/state/app-store.ts:41-135](src/main/state/app-store.ts)).
- Capital.com path identifiers are encoded before being interpolated into endpoint paths ([src/main/trading/capital/client.ts:283-457](src/main/trading/capital/client.ts)).
- Credentials default to macOS keychain storage through `keytar`, with session-only in-memory fallback when unavailable ([src/main/security/credential-store.ts:33-90](src/main/security/credential-store.ts)).
- The renderer clears the password field after a successful connect ([src/renderer/src/App.tsx:357-366](src/renderer/src/App.tsx)).
- Error redaction protects surfaced API keys and CAP-style key material before execution-log storage ([src/main/security/redaction.ts:1-12](src/main/security/redaction.ts), [src/main/state/app-store.ts:130-150](src/main/state/app-store.ts)).

## Recommended next fixes
1. Add explicit user-presence or confirmation checks for saved-session reuse and live-trading mutations.
2. Replace `latest` dependency declarations with reviewed versions/ranges and tighten release/dependency review.
3. Add a conservative packaged-renderer CSP if compatible with the Electron/Vite output.
4. Keep local unsigned packaging gated behind `ALLOW_UNSIGNED_PACKAGING=1` and clearly label any unsigned artifacts.
