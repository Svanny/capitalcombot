import { getTargetPairEligibility } from "@shared/target-position";
import type { ScheduledOrderJob, TradeDirection } from "@shared/types";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { formatDateTime, formatTime } from "../../lib/formatters";

interface TargetPositionButtonProps {
  loading: boolean;
  onSubmit: (
    job: ScheduledOrderJob,
    enabled: boolean,
    direction: TradeDirection,
    size: number,
  ) => Promise<boolean>;
  schedules: ScheduledOrderJob[];
}

interface TargetPairOption {
  epic: string;
  instrumentName: string;
  jobs: ScheduledOrderJob[];
}

export function TargetPositionButton({ loading, onSubmit, schedules }: TargetPositionButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedEpic, setSelectedEpic] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [direction, setDirection] = useState<TradeDirection>("BUY");
  const [size, setSize] = useState("1");
  const [sizeError, setSizeError] = useState<string | null>(null);
  const dialogId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sizeRef = useRef<HTMLInputElement>(null);

  const pairs = useMemo(() => buildTargetPairOptions(schedules), [schedules]);
  const selectedPair = pairs.find((pair) => pair.epic === selectedEpic) ?? pairs[0] ?? null;
  const unavailableReason = getUnavailableReason(schedules);
  const hasActiveTarget = pairs.some((pair) => pair.jobs.every((job) => Boolean(job.targetPosition)));

  function loadPair(pair: TargetPairOption): void {
    const target = pair.jobs.find((job) => job.targetPosition)?.targetPosition;
    setSelectedEpic(pair.epic);
    setEnabled(Boolean(target));
    setDirection(target?.direction ?? pair.jobs[0].direction);
    setSize(String(target?.size ?? pair.jobs[0].size));
    setSizeError(null);
  }

  function openDialog(): void {
    const preferredPair = pairs.find((pair) => pair.jobs.every((job) => Boolean(job.targetPosition))) ?? pairs[0];
    if (!preferredPair) {
      return;
    }

    loadPair(preferredPair);
    setOpen(true);
  }

  function closeDialog(): void {
    if (loading) {
      return;
    }

    setOpen(false);
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedPair) {
      return;
    }

    const normalizedSize = Number(size);
    if (enabled && (!Number.isFinite(normalizedSize) || normalizedSize <= 0)) {
      setSizeError("Enter a target size greater than 0.");
      sizeRef.current?.focus();
      return;
    }

    setSizeError(null);
    const saved = await onSubmit(selectedPair.jobs[0], enabled, direction, normalizedSize);
    if (saved) {
      closeDialog();
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        closeDialog();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, loading]);

  return (
    <div className="target-position-window-control">
      <button
        ref={buttonRef}
        type="button"
        className={`target-position-nav-button${hasActiveTarget ? " is-active" : ""}`}
        disabled={pairs.length === 0}
        title={pairs.length === 0 ? unavailableReason : "Configure a paired target position"}
        aria-controls={dialogId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-pressed={hasActiveTarget}
        onClick={openDialog}
      >
        Target position
      </button>

      {open && selectedPair ? (
        <div className="window-help-overlay target-position-overlay" onClick={closeDialog}>
          <section
            id={dialogId}
            className="window target-position-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="title-bar window-help-title-bar">
              <div id={`${dialogId}-title`} className="title-bar-text">Scheduled Target Position</div>
              <button
                type="button"
                className="window-help-close"
                aria-label="Close target position"
                disabled={loading}
                onClick={closeDialog}
              >
                ×
              </button>
            </div>

            <form className="window-body target-position-dialog-body" onSubmit={(event) => void handleSubmit(event)}>
              <p className="target-position-intro">
                Use the early and late schedules to reach one desired exposure from the live broker position.
              </p>

              {pairs.length > 1 ? (
                <div className="field-row target-position-market-row">
                  <label htmlFor={`${dialogId}-market`}>Market</label>
                  <select
                    id={`${dialogId}-market`}
                    value={selectedPair.epic}
                    onChange={(event) => {
                      const pair = pairs.find((candidate) => candidate.epic === event.target.value);
                      if (pair) {
                        loadPair(pair);
                      }
                    }}
                  >
                    {pairs.map((pair) => (
                      <option key={pair.epic} value={pair.epic}>{pair.instrumentName}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="target-position-market-name">
                  <strong>{selectedPair.instrumentName}</strong>
                  <span>{selectedPair.epic}</span>
                </div>
              )}

              <div className="target-position-pair-preview" aria-label="Paired schedules">
                {selectedPair.jobs.map((job, index) => (
                  <div key={job.id} className="target-position-leg-row">
                    <span className="target-position-leg-label">{index === 0 ? "Early" : "Late"}</span>
                    <strong>{formatScheduleTime(job)}</strong>
                    <span className={`status-pill status-${job.status}`}>{job.status}</span>
                  </div>
                ))}
              </div>

              <label
                className={`target-position-toggle${enabled ? " is-enabled" : ""}`}
                htmlFor={`${dialogId}-enabled`}
              >
                <input
                  id={`${dialogId}-enabled`}
                  type="checkbox"
                  role="switch"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                <span>
                  <strong>Enable target position</strong>
                  <small>Both schedules remain linked until target mode is disabled.</small>
                </span>
              </label>

              <fieldset className="target-position-settings" disabled={!enabled || loading}>
                <legend>Desired position</legend>
                <div className="schedule-radio-group" role="group" aria-label="Target direction">
                  <div className="schedule-radio-option">
                    <input
                      id={`${dialogId}-buy`}
                      type="radio"
                      name={`${dialogId}-direction`}
                      checked={direction === "BUY"}
                      onChange={() => setDirection("BUY")}
                    />
                    <label htmlFor={`${dialogId}-buy`}>Long</label>
                  </div>
                  <div className="schedule-radio-option">
                    <input
                      id={`${dialogId}-sell`}
                      type="radio"
                      name={`${dialogId}-direction`}
                      checked={direction === "SELL"}
                      onChange={() => setDirection("SELL")}
                    />
                    <label htmlFor={`${dialogId}-sell`}>Short</label>
                  </div>
                </div>

                <div className={sizeError ? "field-shell has-error" : "field-shell"}>
                  <div className="field-row-stacked">
                    <label htmlFor={`${dialogId}-size`}>Target size</label>
                    <input
                      ref={sizeRef}
                      id={`${dialogId}-size`}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={size}
                      aria-invalid={Boolean(sizeError)}
                      onChange={(event) => {
                        setSize(event.target.value);
                        setSizeError(null);
                      }}
                    />
                  </div>
                  {sizeError ? <p className="field-error">{sizeError}</p> : null}
                </div>
              </fieldset>

              <p className="target-position-policy-note">
                Long targets flatten early and enter late. Short targets execute early. The Friday close flattens on
                Saturday’s early leg; Saturday late and Sunday skip.
              </p>

              <div className="button-row">
                <button type="submit" className="default" disabled={loading}>
                  {loading ? "Saving…" : "Save changes"}
                </button>
                <button type="button" className="ghost" disabled={loading} onClick={closeDialog}>Cancel</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function buildTargetPairOptions(schedules: ScheduledOrderJob[]): TargetPairOption[] {
  const epics = [...new Set(
    schedules
      .filter((job) => job.status === "scheduled" || job.status === "paused")
      .map((job) => job.epic),
  )];

  return epics.flatMap((epic) => {
    const eligibility = getTargetPairEligibility(schedules, epic);
    if (!eligibility.eligible) {
      return [];
    }

    return [{
      epic,
      instrumentName: eligibility.jobs[0].instrumentName,
      jobs: eligibility.jobs,
    }];
  });
}

function getUnavailableReason(schedules: ScheduledOrderJob[]): string {
  const editable = schedules.filter((job) => job.status === "scheduled" || job.status === "paused");
  if (editable.length === 0) {
    return "Create two scheduled or paused orders for the same market first.";
  }

  return "Requires exactly two same-market orders with the same schedule type and distinct times.";
}

function formatScheduleTime(job: ScheduledOrderJob): string {
  return job.scheduleType === "repeating" && job.runTime
    ? `Daily ${formatTime(job.runTime)}`
    : formatDateTime(job.runAt);
}
