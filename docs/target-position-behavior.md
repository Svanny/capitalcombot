# Target-position scheduling

Each pair has an early and late leg for the same market. BUY exposure is positive;
SELL exposure is negative. Orders use the difference between the required exposure
and the broker's live net exposure, fetched separately for each execution.

| Local schedule day | Target | Early required exposure | Late required exposure |
| --- | --- | --- | --- |
| Sunday–Friday | Long | Zero | Positive target size |
| Sunday–Friday | Short | Negative target size | Negative target size |
| Saturday (Friday overnight close) | Either | Zero | Signed target size |

The late short check recovers an earlier failure or intervening position change.
If the market is closed, the broker rejection is recorded and a repeating job
tries at its next daily occurrence. Zero differences never submit an order.

## Pause behavior

- Saving a target pauses legs whose projected difference is zero.
- An automatic pause retains a scheduled live check. It can submit an adjustment
  when exposure changes or Saturday's flatten/entry rules apply.
- A repeating no-op stays automatically paused until its next check. A one-off
  no-op completes with an informational result.
- Saving a changed target immediately re-evaluates both legs.
- Manual Pause disables checks until Resume, including across target edits and
  restarts. Automatically paused cards show **Auto-paused**, their next check time,
  and **Stop auto-checks** to switch to a manual pause; only manual pauses show Resume.
- Automatic and manual pauses are distinguished by persisted metadata, not by
  the card's displayed BUY/SELL fields. Legacy automatic pause reasons are migrated.

## Saving and restoring

Leg roles follow configured clock times. The preview processes their next actual
occurrences chronologically, preserving a pending late run when saving after the
early time. A manually paused leg does not change projected exposure.

Paired updates persist before replacing timers. A failed save leaves the old jobs
and timers intact. Restoring schedules preserves manual pauses and schedules the
next daily check for missed repeating occurrences; it does not replay missed orders.
If the app stopped during execution, repeating schedules resume at their next future
daily occurrence with an unknown-outcome message. Interrupted one-off orders are
marked failed and require checking the broker account before scheduling another order.
Malformed broker position snapshots are rejected; only an explicit empty positions
array is treated as a flat portfolio.
The app must be running and connected to execute schedules.

## Verification

The lifecycle matrix covers seven days, seven starting exposures, both target
directions, and daily/one-off schedules. Additional tests cover target switches,
manual pauses, failed early orders, exposure drift, restart normalization, disabling
target mode, failed persistence, timer limits, malformed inputs, and UI controls.
Broker executions are simulated in tests; no live trading is part of verification.
