# Adversarial app and CLI testing — 2026-09-27

All findings reproduced in this pass have been fixed. The test suite increased from 435 to 517 tests; all 21 test files pass. `pnpm build` passes TypeScript checking and builds the main process, preload, and renderer.

| Surface | Reproduction / failure | Fix and coverage |
| --- | --- | --- |
| CLI arguments | `--yes=false` was treated as confirmation. Misspelled flags, duplicate options, and extra position IDs were ignored. | Explicit option types, command-specific allowed options, argument counts, and duplicate rejection in a reusable parser module. Parser matrices and real CLI subprocess tests cover refusal before contacting the app. |
| CLI authentication and framing | JSON `null` and a 64-character Unicode token caused unhandled rejections. | Validate request envelopes and compare token byte lengths safely. Socket tests cover malformed JSON, primitive values, malformed authenticated fields, oversized frames, bad tokens, and server health after rejection. |
| CLI confirmation | Raw `schedules.update` calls containing target-position settings bypassed CLI confirmation. | Require confirmation at CLI dispatch, including target updates. Preserve the intentionally different GUI target-position flow. |
| CLI responses and lifecycle | A peer closing without a complete response left the client promise pending. Malformed response envelopes could report success. Shutdown waited for idle sockets. GUI notification errors could report a completed trade as failed. | Reject incomplete/invalid responses, enforce an absolute response deadline and request size limit, close owned sockets at shutdown, and isolate notification failures from operation results. Timeout/disconnect errors tell callers to check the outcome before retrying. |
| Credentials | Both CLI and IPC validation trimmed password whitespace. | Preserve the exact password while continuing to reject blank credentials. Tests verify both boundaries and credential storage. |
| Broker session concurrency | Delayed login could restore a disconnected session; delayed logout could erase a new session; simultaneous expired-session reads created duplicate logins. | Version session changes, clear local authentication before logout awaits network I/O, and share an in-progress login. Deferred-response tests cover these interleavings. Broker requests also have a 15-second abort deadline. |
| Market selection | A delayed quote response could overwrite a different market selected through another handler. | Check the current selection before persisting the quote. Regression test uses separate GUI and CLI handler instances sharing state. |
| Position protection | Caller-provided market/direction could disagree with the position being updated. Finite inputs could calculate negative or infinite protection levels. | Verify the open position's market and direction, reject missing positions, and validate calculated levels before submission. Existing ADX success coverage now uses multipliers that produce positive levels. |
| Renderer refresh | Quote/schedule failures discarded successful position refreshes. A delayed refresh could restore positions after GUI disconnect. Repeated polling could indefinitely supersede slower responses. | Handle refresh results independently, invalidate refreshes on disconnect, and avoid overlapping background polls. UI tests cover CLI notifications, disconnect races, partial failures, and a 10-second response crossing an 8-second polling interval. |
| Renderer resilience | Invalid currency codes threw during portfolio rendering. Non-finite values appeared as prices. | Fall back to numeric display for invalid currency syntax, render unavailable numeric values as placeholders, and expose portfolio errors in an alert. Formatter tests and the UI matrix cover these inputs. |

History reviewed included the CLI introduction (`2c39cb5`), GUI synchronization (`bd02d16`), target-position confirmation behavior (`39bffc0`), IPC validation refactor (`cdd5d36`), and original formatter/protection behavior. These checks distinguished intended target-position behavior from the new CLI bypass and identified older robustness gaps without attributing every issue to a recent regression.

Validation commands:

```text
pnpm test
pnpm build
git diff --check
```

The production renderer was also exercised in the collaborative browser with an isolated mock `capitalApi`: an invalid size made zero order calls, a rejected order restored the submit control, quote failure still allowed updated positions to render, an invalid currency did not crash the portfolio, and disconnect removed stale positions. Browser snapshot capture failed in the preview tool; interaction and DOM inspection succeeded through its click, type, and evaluate tools.

No real credentials or broker orders were used. Broker behavior was simulated with fetch mocks, and CLI behavior was tested with real loopback sockets and subprocesses. Native packaged Electron dialogs, live broker integration, and sustained load were not tested in this pass. This is coverage of the documented scenarios, not a claim that all possible defects have been eliminated.
