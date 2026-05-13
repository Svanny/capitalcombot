# Capitalcombot Threat Model

> Note: refreshed May 13, 2026 after follow-up remediation for Electron sandboxing, IPC validation, main-process user-presence confirmation, signed-packaging gates, state integrity, and Capital.com path-segment encoding.

## Executive summary
`capitalcombot` is a local Electron desktop trading client that can authenticate to Capital.com, place immediate or scheduled market orders, and update position protection from a privileged Electron main process ([README.md:3-15](README.md), [src/main/index.ts:11-39](src/main/index.ts), [src/main/ipc.ts:61-97](src/main/ipc.ts)). The highest-risk themes are still privilege-boundary failure between the renderer and the privileged main process, locally persisted trading state, and supply-chain/distribution tampering for a finance-sensitive desktop app; current controls now include Electron sandboxing, a restrictive packaged-renderer CSP, runtime IPC validation, native main-process confirmation before high-risk trading/auth actions, signed state envelopes when secure storage is available, signed-packaging gates, and encoded Capital.com path identifiers ([src/main/index.ts:21-38](src/main/index.ts), [src/renderer/index.html:1-14](src/renderer/index.html), [src/main/ipc.ts:64-379](src/main/ipc.ts), [src/main/state/app-store.ts:41-135](src/main/state/app-store.ts), [scripts/package-mac.sh:4-30](scripts/package-mac.sh), [scripts/package-win-docker.sh:4-40](scripts/package-win-docker.sh), [src/main/trading/capital/client.ts:283-457](src/main/trading/capital/client.ts)).

## Scope and assumptions
- In scope:
  - Electron runtime, including `src/main/index.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/trading/capital/client.ts`, `src/main/security/*`, `src/main/state/*`, `src/main/trading/*`, `src/shared/*`
  - Renderer-driven trading flows in `src/renderer/**`
  - Packaging and distribution config in `electron-builder.yml` and `scripts/package-*.sh`
- Out of scope:
  - Capital.com backend internals and Capital.com-side auth/session protections
  - OS- or firmware-level compromise beyond normal user-space assumptions
  - Infrastructure outside the repo, including network perimeter controls, notarization pipelines, or artifact-hosting protections not represented here
- Assumptions:
  - Intended usage is a personal/local desktop app on a mostly trusted machine.
  - Demo and live Capital.com environments are both realistic; severity is ranked by worst plausible live-trading impact.
  - Release notes identify signed versus unsigned artifacts, and local unsigned macOS/Windows packaging requires `ALLOW_UNSIGNED_PACKAGING=1` ([README.md:29-31](README.md), [README.md:153](README.md), [scripts/package-mac.sh:4-30](scripts/package-mac.sh), [scripts/package-win-docker.sh:4-40](scripts/package-win-docker.sh)).
  - Local users who can already fully control the host are not treated as a separate app-layer identity boundary, but local tampering still matters because persisted state can trigger live trades later.
- Open questions that could materially change ranking:
  - Whether future releases will always have signing credentials and notarization available.
  - Whether the renderer will ever load remote content outside current dev-only `ELECTRON_RENDERER_URL` usage ([src/main/index.ts:62-65](src/main/index.ts)).

## System model
### Primary components
- Renderer UI: React UI that captures credentials, market search, order tickets, schedules, and protection updates, then calls `window.capitalApi.*` ([src/renderer/src/App.tsx:342-417](src/renderer/src/App.tsx), [src/renderer/src/App.tsx:507-645](src/renderer/src/App.tsx)).
- Preload bridge: exposes a fixed `capitalApi` object backed by `ipcRenderer.invoke` into the renderer global namespace ([src/preload/index.ts:15-78](src/preload/index.ts)).
- Electron main process: creates the browser window with Chromium sandboxing, restores scheduled jobs, registers IPC handlers, and instantiates the Capital client and stores ([src/main/index.ts:11-39](src/main/index.ts), [src/main/index.ts:41-89](src/main/index.ts)).
- IPC layer: maps renderer calls to privileged actions such as connect, trade placement, schedule creation/cancellation, quote fetches, and protection updates ([src/main/ipc.ts:61-97](src/main/ipc.ts), [src/main/ipc.ts:236-362](src/main/ipc.ts)).
- Capital API client: holds in-memory session tokens and credentials, authenticates to Capital.com demo/live endpoints, and performs market/order/position operations over HTTPS ([src/main/trading/capital/client.ts:71-122](src/main/trading/capital/client.ts), [src/main/trading/capital/client.ts:389-499](src/main/trading/capital/client.ts)).
- Local persistence:
  - Credentials: saved to macOS keychain through `keytar`, with in-memory-only fallback when `keytar` is unavailable ([src/main/security/credential-store.ts:33-90](src/main/security/credential-store.ts), [README.md:86-88](README.md)).
  - Non-secret state: `electron-store` persists selected market, schedules, execution log, and saved profile ([src/main/state/app-store.ts:11-17](src/main/state/app-store.ts), [src/main/state/app-store.ts:72-100](src/main/state/app-store.ts), [README.md:83-88](README.md)).
- Packaging: DMG/NSIS/Linux output through GitHub Actions or local scripts; signed macOS/Windows packaging is used when credentials are present, while local unsigned macOS/Windows packaging is explicitly gated by `ALLOW_UNSIGNED_PACKAGING=1` ([README.md:29-31](README.md), [README.md:153](README.md), [scripts/package-mac.sh:4-30](scripts/package-mac.sh), [scripts/package-win-docker.sh:4-40](scripts/package-win-docker.sh), [scripts/package-win-native.mjs:10-28](scripts/package-win-native.mjs)).

### Data flows and trust boundaries
- User -> Renderer UI
  - Data: Capital identifier, password, API key, market queries, order parameters, schedule times, protection inputs
  - Channel: local desktop UI events
  - Guarantees: renderer form validation exists for common fields and schedule formats ([src/renderer/src/lib/validation.ts:28-105](src/renderer/src/lib/validation.ts))
  - Validation: renderer form validation exists for user feedback, and the main process repeats runtime validation before privileged IPC actions ([src/renderer/src/lib/validation.ts:28-105](src/renderer/src/lib/validation.ts), [src/main/ipc.ts:99-429](src/main/ipc.ts))
- Renderer -> Preload bridge
  - Data: structured trading, auth, schedule, and protection requests
  - Channel: `window.capitalApi` methods exposed via `contextBridge`
  - Guarantees: fixed method surface, `contextIsolation: true`, `nodeIntegration: false`, Chromium sandboxing, and packaged-renderer CSP ([src/main/index.ts:21-32](src/main/index.ts), [src/preload/index.ts:43-78](src/preload/index.ts), [src/renderer/index.html:1-14](src/renderer/index.html))
  - Validation: none in preload beyond error parsing; payloads are passed directly to IPC invoke ([src/preload/index.ts:15-20](src/preload/index.ts))
- Preload/Renderer -> Main process IPC
  - Data: credentials, order requests, protection configs, deal IDs, schedule IDs
  - Channel: Electron `ipcRenderer.invoke` / `ipcMain.handle`
  - Guarantees: channel names are fixed, payloads are normalized and validated in the main process, malformed inputs are rejected before privileged client/scheduler calls, and high-risk actions require native main-process user confirmation ([src/main/ipc.ts:61-97](src/main/ipc.ts), [src/main/ipc.ts:99-429](src/main/ipc.ts))
  - Validation: runtime checks cover credentials, market/order inputs, position identifiers, protection strategies, and schedule updates; saved-session reuse, order placement/scheduling, position mutations, and schedule mutations require user confirmation before privileged services are called ([src/main/ipc.ts:64-379](src/main/ipc.ts))
- Main process -> Local credential store / local app state
  - Data: full Capital credentials in keychain or memory; saved profile, schedules, execution log, selected market in `electron-store`
  - Channel: local OS keychain APIs and filesystem-backed Electron store
  - Guarantees: credentials are intended to remain in main process and keychain-backed when available ([README.md:7](README.md), [src/main/security/credential-store.ts:33-90](src/main/security/credential-store.ts))
  - Validation: persisted state is signed when secure state integrity storage is available; legacy or invalid signed-state reads drop schedules and execution log before writing a fresh signed envelope ([src/main/state/app-store.ts:41-135](src/main/state/app-store.ts), [src/main/state/app-store.ts:253-421](src/main/state/app-store.ts))
- Main process -> Capital.com API
  - Data: identifier/password/API key on session creation; session tokens on subsequent requests; market/order/protection data
  - Channel: HTTPS `fetch` to demo/live Capital.com API endpoints ([src/main/trading/capital/client.ts:71-122](src/main/trading/capital/client.ts), [src/main/trading/capital/client.ts:389-449](src/main/trading/capital/client.ts))
  - Guarantees: HTTPS via remote API URLs; session headers kept in main-process memory only
  - Validation: response status checked, limited response normalization, deal confirmations retried ([src/main/trading/capital/client.ts:451-499](src/main/trading/capital/client.ts))
- Persisted schedule state -> Scheduler execution
  - Data: order direction, size, market epic, run time, protection settings
  - Channel: `electron-store` -> scheduler restore -> timers -> order placement
  - Guarantees: persisted schedules are normalized before restore, invalid nested protection data is rejected, duplicate IDs are repaired, timers are not armed until native startup confirmation, and execution still requires an active Capital session ([src/main/index.ts:81-122](src/main/index.ts), [src/main/state/app-store.ts:253-421](src/main/state/app-store.ts), [src/main/trading/scheduler.ts:52-197](src/main/trading/scheduler.ts), [src/main/trading/capital/client.ts:412-430](src/main/trading/capital/client.ts))
  - Validation: restored pending jobs are either armed after explicit startup confirmation or cancelled before any restored timer can fire.
- Build operator -> Packaging scripts / output installers
  - Data: source tree, dependency graph, generated installer artifacts
  - Channel: local shell, Docker/Wine for Windows packaging
  - Guarantees: `pnpm install --frozen-lockfile` is used in the Windows packaging container, and macOS/Windows local packaging refuses unsigned output unless explicitly allowed ([scripts/package-win-docker.sh:27-40](scripts/package-win-docker.sh), [scripts/package-mac.sh:4-30](scripts/package-mac.sh), [scripts/package-win-native.mjs:10-28](scripts/package-win-native.mjs))
  - Validation: release notes and hashes remain important because local unsigned artifacts can still be produced for personal builds.

#### Diagram
```mermaid
flowchart TD
  U["Local User"] --> R["Renderer UI"]
  R --> P["Preload Bridge"]
  P --> I["IPC Handlers"]
  I --> M["Main Process Services"]
  M --> K["Keychain or Memory Credentials"]
  M --> S["Electron Store State"]
  M --> C["Capital.com API"]
  S --> Q["Scheduler"]
  Q --> M
  B["Build Operator"] --> G["Packaging Scripts"]
  G --> O["Signed or Explicitly Unsigned Installers"]
```

## Assets and security objectives
| Asset | Why it matters | Security objective (C/I/A) |
| --- | --- | --- |
| Capital credentials (identifier, password, API key) | Can initiate authenticated broker sessions and enable live trading | C, I |
| Session headers (`CST`, `X-SECURITY-TOKEN`) | Permit authenticated Capital API calls after login | C, I |
| Order intent and protection parameters | Unauthorized changes can place or alter live trades | I |
| Persisted schedules and execution log | Can trigger later trade execution or mislead operator activity review | I, A |
| Packaged installer artifacts | Tampered builds can exfiltrate credentials or silently place trades | I |
| Availability of main-process trading services | UI or automation failure can block or mis-time order execution | A |

## Attacker model
### Capabilities
- Can influence renderer input through local UI use, malicious pasted values, or a compromised renderer/web content path.
- Can tamper with local non-keychain app state if they obtain user-level filesystem access to the host and secure state integrity storage is unavailable or compromised.
- Can tamper with unsigned build artifacts or substitute a malicious installer if distribution is done through ad hoc channels.
- Can exploit business actions exposed by preload and IPC if the renderer trust boundary fails.

### Non-capabilities
- Does not inherently control Capital.com backend responses or Capital.com authentication systems.
- Is not assumed to have kernel- or firmware-level control of the host for baseline ranking.
- Cannot directly read full credentials from renderer state after successful connect because the password is cleared in the UI and credentials are meant to stay in the main process/keychain ([src/renderer/src/App.tsx:357-366](src/renderer/src/App.tsx), [README.md:7](README.md)).

## Entry points and attack surfaces
| Surface | How reached | Trust boundary | Notes | Evidence (repo path / symbol) |
| --- | --- | --- | --- | --- |
| Login form | User submits credentials in renderer | User -> Renderer -> IPC -> Main | Credentials cross into main process and are saved to keychain/memory | `src/renderer/src/App.tsx` `handleConnect`; `src/main/ipc.ts` `connect`; `src/main/security/credential-store.ts` |
| Saved-credentials login | Renderer invokes `connectSaved` | Renderer -> IPC -> Main -> Keychain | Lets any renderer code trigger reuse of saved credentials | `src/preload/index.ts:47-52`, `src/main/ipc.ts:146-156` |
| Market search/select | Renderer search box and selection | Renderer -> IPC -> Main -> Capital API | Mostly lower risk data fetch, but part of authenticated session surface | `src/main/ipc.ts:180-223`, `src/main/trading/capital/client.ts:136-192` |
| Immediate market order | Order ticket submit | Renderer -> IPC -> Main -> Capital API | Integrity-critical live trading action | `src/renderer/src/App.tsx:507-545`, `src/main/ipc.ts:236-286`, `src/main/trading/capital/client.ts:244-281` |
| Scheduled market order | Order ticket with schedule | Renderer -> IPC -> Main -> electron-store -> timers | Integrity-critical and persists across app sessions | `src/main/ipc.ts:248-258`, `src/main/trading/scheduler.ts:58-79` |
| Protection preview/update | Protection form and update action | Renderer -> IPC -> Main -> Capital API | Can materially change live position risk | `src/main/ipc.ts:101-111`, `src/main/ipc.ts:319-349`, `src/main/trading/protection.ts` |
| Scheduler restore/execute | App startup and timer firing | Persisted store -> Main -> Capital API | Local persisted state can later drive automatic trades | `src/main/index.ts:71-89`, `src/main/trading/scheduler.ts:44-52`, `src/main/trading/scheduler.ts:162-252` |
| Packaging scripts | Local build operator runs package commands | Build env -> output installers | Finance app installers should be signed for distribution; unsigned local builds are explicitly gated | `README.md:153`, `scripts/package-*.sh` |

## Top abuse paths
1. Attacker gains renderer-code execution -> calls `window.capitalApi.orders.openMarket` or `window.capitalApi.positions.updateProtection` -> main process accepts payload -> live Capital account receives unauthorized trade or risk change.
2. Attacker gains renderer-code execution -> calls `window.capitalApi.auth.connectSaved` -> app reuses stored credentials -> attacker then drives authenticated trading actions without re-entering secrets.
3. Attacker with local filesystem access alters persisted schedule state while secure state integrity is unavailable -> scheduler restores and arms tampered jobs on next launch -> later connected session executes unintended trade.
4. Attacker distributes a trojanized unsigned local DMG/NSIS build -> user installs and authenticates -> malicious code captures credentials or issues broker actions from the privileged main process.
5. Malicious renderer payload reaches IPC boundary -> malformed objects are rejected, and syntactically valid high-risk actions still require native main-process user confirmation before privileged services are called.
6. Local tampering changes execution-log or schedule records when signed state storage is unavailable -> operator sees misleading state about what is queued or what already ran -> delayed detection of unauthorized or unintended trades.

## Threat model table
| Threat ID | Threat source | Prerequisites | Threat action | Impact | Impacted assets | Existing controls (evidence) | Gaps | Recommended mitigations | Detection ideas | Likelihood | Impact severity | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TM-001 | Compromised renderer or malicious content in renderer context | Renderer-code execution or any future remote-content/XSS path | Use exposed preload methods to invoke privileged IPC trading/auth actions | Unauthorized live trades, protection changes, or session reuse | Credentials, session, order intent | `contextIsolation`, Chromium sandboxing, `nodeIntegration: false`, and a packaged-renderer CSP are enabled; preload exposes a fixed API surface; IPC handlers runtime-validate payloads; high-risk saved-session, order, position, and schedule mutations require native main-process user confirmation ([src/main/index.ts:21-32](src/main/index.ts), [src/renderer/index.html:1-14](src/renderer/index.html), [src/preload/index.ts:43-78](src/preload/index.ts), [src/main/ipc.ts:64-429](src/main/ipc.ts)) | A compromised renderer can still request the action, but cannot complete it without the user accepting the native prompt | Add structured audit logging for confirmed and rejected sensitive IPC actions | Log and alert on unexpected trade calls, schedule creation, and `connectSaved` usage; add IPC audit logging with action + origin metadata | Low | High | medium |
| TM-002 | Local user-space attacker or malware with filesystem access | Access to app state while secure state integrity is unavailable or compromised | Modify queued schedules or execution state so restored jobs execute attacker-chosen trades later | Unintended order placement or misleading operator view of queued actions | Order intent, persisted schedules, execution log | State uses signed envelopes when secure state integrity is available; schedules are normalized deeply; restored pending jobs require native startup confirmation before timers are armed; live execution still needs a connected session ([src/main/index.ts:81-122](src/main/index.ts), [src/main/state/app-store.ts:41-135](src/main/state/app-store.ts), [src/main/state/app-store.ts:253-421](src/main/state/app-store.ts), [src/main/trading/scheduler.ts:52-197](src/main/trading/scheduler.ts), [README.md:131-134](README.md)) | Memory fallback disables persistence; a user can still explicitly approve a restored schedule | Keep restore confirmation prominent and preserve checksum failure logs | Log schedule restore events, checksum failures, and any job mutated after initial creation; show high-visibility banner for restored schedules | Low | High | low |
| TM-003 | Malicious distributor, build host compromise, or artifact substitution | User installs an unsigned build from an untrusted or weakly trusted channel | Replace app binary or installer with malicious version that captures secrets or issues trades | Full compromise of credentials and trading integrity | Installer artifacts, credentials, order flow | Packaging process is documented and reproducible locally; Windows packaging uses `--frozen-lockfile`; macOS and Windows scripts require signing credentials unless `ALLOW_UNSIGNED_PACKAGING=1` is set ([scripts/package-win-docker.sh:4-40](scripts/package-win-docker.sh), [scripts/package-mac.sh:4-30](scripts/package-mac.sh), [scripts/package-win-native.mjs:10-28](scripts/package-win-native.mjs), [README.md:29-31](README.md)) | Local unsigned builds remain possible and notarization depends on available release credentials | Prefer signed/notarized release artifacts, publish checksums/signatures, separate trusted release pipeline from local dev packaging | Track artifact hashes, release provenance, and download locations; clearly label unsigned release usage for live trading | Medium | High | high |
| TM-004 | Malicious or buggy renderer payload | Ability to invoke exposed preload methods | Send malformed or out-of-policy IPC payloads | App crash, inconsistent state, or privileged action with unexpected parameters | Main-process availability, order integrity | Main IPC handlers validate credentials, identifiers, orders, schedules, and protection strategies before calling privileged services; high-risk mutations require native confirmation ([src/main/ipc.ts:64-429](src/main/ipc.ts)); Capital.com path identifiers are URL-encoded ([src/main/trading/capital/client.ts:283-457](src/main/trading/capital/client.ts)) | Valid lower-risk data-fetch actions still depend on the renderer/user interaction model | Add audit counters for sensitive IPC methods | Count and surface rejected IPC payloads, channel-specific exception rates, and unexpected validation failures | Low | Medium | low |
| TM-005 | Dependency supply-chain attacker or accidental upstream regression | New install, lockfile refresh, or rebuild with changed upstream package releases | Introduce malicious or breaking dependency into privileged Electron runtime or packaging toolchain | Credential theft, privilege-boundary failure, or release compromise | Build pipeline, runtime dependencies | Lockfile exists, manifests pin reviewed versions, dependency overrides remove known vulnerable transitive versions, Windows packaging uses `pnpm install --frozen-lockfile`, and `pnpm audit --audit-level moderate` currently reports no known vulnerabilities ([package.json:20-59](package.json), [pnpm-lock.yaml](pnpm-lock.yaml), [scripts/package-win-docker.sh:28](scripts/package-win-docker.sh)) | Supply-chain risk still exists when intentionally refreshing pinned versions or release tooling | Keep lockfile changes under deliberate review and run dependency-audit/release-review policy for finance-sensitive packages | Alert on lockfile drift, review dependency diffs in PRs, and record package provenance for release builds | Low | Medium | low |

## Criticality calibration
- `critical` for this repo:
  - Any path that enables silent live-trade placement without user intent
  - Credential or session-token theft that gives direct broker access
  - Signed/official release-channel compromise once release signing exists
- `high` for this repo:
  - Renderer compromise that drives syntactically valid authenticated trading
  - Persisted schedule tampering when secure state integrity is unavailable
  - Unsigned installer tampering in ad hoc distribution paths
- `medium` for this repo:
  - IPC payload abuse that crashes the app or causes inconsistent trading state
  - Dependency drift that weakens supply-chain review but still depends on lockfile or install-path conditions
  - Local log/state tampering that misleads the operator without directly exposing broker credentials
- `low` for this repo:
  - Low-sensitivity UI metadata exposure such as selected market or non-secret status messages
  - Development-only issues that require `ELECTRON_RENDERER_URL` or local dev tooling and do not affect shipped builds

Examples by level:
- `critical`: silent live order execution from a compromised release build; theft of reusable Capital session headers.
- `high`: compromised renderer invoking `connectSaved` then placing orders; tampered restored schedule firing a live order.
- `medium`: malformed IPC payload causing repeated scheduler failures; dependency update introducing weakened Electron defaults before release review.
- `low`: exposure of selected market or schedule count in local UI state; missing hardening for purely dev-only hot reload usage.

## Focus paths for security review
| Path | Why it matters | Related Threat IDs |
| --- | --- | --- |
| `src/main/index.ts` | Defines Electron window hardening posture and startup restore order | TM-001, TM-002 |
| `src/preload/index.ts` | Exposes the privileged renderer API surface | TM-001, TM-004 |
| `src/main/ipc.ts` | Main-process trust boundary for all auth, trading, and scheduling actions | TM-001, TM-004 |
| `src/main/trading/capital/client.ts` | Holds session tokens and performs live broker actions | TM-001, TM-003 |
| `src/main/security/credential-store.ts` | Controls credential persistence and fallback behavior | TM-001, TM-003 |
| `src/main/state/app-store.ts` | Persists integrity-critical schedule/log/profile state | TM-002 |
| `src/main/trading/scheduler.ts` | Restores, arms, and executes persisted trade schedules | TM-002, TM-004 |
| `electron-builder.yml` | Captures unsigned packaging defaults | TM-003 |
| `scripts/package-win-docker.sh` | Build chain for Windows release artifacts | TM-003, TM-005 |
| `package.json` | Shows dependency versioning strategy and build/runtime trust base | TM-005 |
