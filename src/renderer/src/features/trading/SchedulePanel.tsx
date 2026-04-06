import type {
  ResolvedProtection,
  ScheduledOrderJob,
  ScheduledOrderType,
  TradeDirection,
} from "@shared/types";
import type { FormEvent, RefObject } from "react";
import type { OrderFieldName } from "../../lib/validation";
import type { ProtectionFieldName, ProtectionFormState } from "../../lib/protection-form";
import { formatDateTime, formatTime } from "../../lib/formatters";
import { ProtectionStrategyFields } from "../../ui/ProtectionStrategyFields";
import { WindowHelpButton } from "../../ui/WindowHelpButton";

interface SchedulePanelProps {
  editingJobId: string | null;
  editDirection: TradeDirection;
  editErrors: Partial<Record<OrderFieldName, string>>;
  editProtectionErrors: Partial<Record<ProtectionFieldName, string>>;
  editProtectionPreview: ResolvedProtection | null;
  editProtectionPreviewError: string | null;
  editProtectionRefs: Partial<Record<ProtectionFieldName, RefObject<HTMLInputElement | null>>>;
  editProtectionValues: ProtectionFormState;
  editRunAt: string;
  editRunTime: string;
  editScheduleType: ScheduledOrderType;
  editSize: string;
  loadingCancel: boolean;
  loadingEditPreview: boolean;
  loadingUpdate: boolean;
  onCancel: (job: ScheduledOrderJob) => Promise<void>;
  onEdit: (job: ScheduledOrderJob) => void;
  onEditCancel: () => void;
  onEditDirectionChange: (direction: TradeDirection) => void;
  onEditProtectionChange: <TField extends keyof ProtectionFormState>(
    field: TField,
    value: ProtectionFormState[TField],
  ) => void;
  onEditRunAtChange: (value: string) => void;
  onEditRunTimeChange: (value: string) => void;
  onEditScheduleTypeChange: (value: ScheduledOrderType) => void;
  onEditSizeChange: (value: string) => void;
  onEditSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  refs: Pick<Record<OrderFieldName, RefObject<HTMLInputElement | null>>, "size" | "scheduleAt">;
  schedules: ScheduledOrderJob[];
}

export function SchedulePanel({
  editingJobId,
  editDirection,
  editErrors,
  editProtectionErrors,
  editProtectionPreview,
  editProtectionPreviewError,
  editProtectionRefs,
  editProtectionValues,
  editRunAt,
  editRunTime,
  editScheduleType,
  editSize,
  loadingCancel,
  loadingEditPreview,
  loadingUpdate,
  onCancel,
  onEdit,
  onEditCancel,
  onEditDirectionChange,
  onEditProtectionChange,
  onEditRunAtChange,
  onEditRunTimeChange,
  onEditScheduleTypeChange,
  onEditSizeChange,
  onEditSubmit,
  refs,
  schedules,
}: SchedulePanelProps) {
  return (
    <section className="window section-window schedule-window">
      <div className="title-bar">
        <div className="title-bar-text">Scheduled Orders</div>
        <div className="title-bar-controls">
          <WindowHelpButton
            title="Scheduled Orders"
            hints={[
              "Scheduled orders run only while this desktop app stays open.",
              "Edit pending jobs inline to update timing, size, direction, and protection.",
              "Missed or failed jobs remain visible here for review.",
            ]}
          />
        </div>
      </div>
      <div className="window-body section-window-body schedule-window-body">
        <div className="schedule-list schedule-scroll-list">
          {schedules.length === 0 ? (
            <div className="empty-state">
              <strong>No scheduled orders.</strong>
              <p>Use the Trading tab to queue a market order for a later date or daily time.</p>
            </div>
          ) : (
            schedules.map((job) => {
              const isEditing = editingJobId === job.id;
              const isPending = job.status === "scheduled";

              return (
                <article key={job.id} className="schedule-card">
                  <div className="schedule-card-header">
                    <strong>
                      {job.direction} {formatOrderSize(job.size)} {job.instrumentName}
                    </strong>
                    <p>
                      {job.scheduleType === "repeating" && job.runTime
                        ? `Daily at ${formatTime(job.runTime)}`
                        : `One-off at ${formatDateTime(job.runAt)}`}
                    </p>
                  </div>
                  <div className="schedule-meta">
                    <span className={`status-pill status-${job.status}`}>{job.status}</span>
                    <span>
                      {job.reason ??
                        (job.scheduleType === "repeating"
                          ? `Next run ${formatDateTime(job.runAt)}`
                          : "Waiting for schedule window.")}
                    </span>
                  </div>
                  {isPending ? (
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={loadingUpdate}
                        onClick={() => onEdit(job)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={loadingCancel}
                        onClick={() => void onCancel(job)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {isEditing ? (
                    <form className="schedule-edit-form" onSubmit={onEditSubmit} noValidate>
                      <div className="schedule-edit-header">
                        <div>
                          <strong>Edit pending order</strong>
                          <p>Adjust direction, size, timing, or protection before the next run.</p>
                        </div>
                        <div className="schedule-edit-meta">
                          {job.instrumentName} · {job.scheduleType === "repeating" ? "Repeating" : "One-off"}
                        </div>
                      </div>

                      <div className="schedule-edit-grid">
                        <fieldset className="schedule-edit-section">
                          <legend>Order setup</legend>
                          <p className="schedule-edit-note">Choose side and confirm position size.</p>

                          <div className="schedule-radio-group" role="group" aria-label="Order direction">
                            <div className="schedule-radio-option">
                              <input
                                id={`schedule-edit-buy-${job.id}`}
                                type="radio"
                                name={`schedule-direction-${job.id}`}
                                checked={editDirection === "BUY"}
                                onChange={() => onEditDirectionChange("BUY")}
                              />
                              <label htmlFor={`schedule-edit-buy-${job.id}`}>Buy</label>
                            </div>
                            <div className="schedule-radio-option">
                              <input
                                id={`schedule-edit-sell-${job.id}`}
                                type="radio"
                                name={`schedule-direction-${job.id}`}
                                checked={editDirection === "SELL"}
                                onChange={() => onEditDirectionChange("SELL")}
                              />
                              <label htmlFor={`schedule-edit-sell-${job.id}`}>Sell</label>
                            </div>
                          </div>

                          <div className={editErrors.size ? "field-shell has-error" : "field-shell"}>
                            <div className="field-row-stacked">
                              <label htmlFor={`schedule-size-${job.id}`}>Size</label>
                              <input
                                id={`schedule-size-${job.id}`}
                                ref={refs.size}
                                aria-invalid={Boolean(editErrors.size)}
                                inputMode="decimal"
                                min="0.01"
                                step="0.01"
                                type="number"
                                value={editSize}
                                onChange={(event) => onEditSizeChange(event.target.value)}
                              />
                            </div>
                            {editErrors.size ? <p className="field-error">{editErrors.size}</p> : null}
                          </div>
                        </fieldset>

                        <fieldset className="schedule-edit-section">
                          <legend>Timing</legend>
                          <p className="schedule-edit-note">Switch between a one-time run or a daily recurring time.</p>

                          <div className="schedule-radio-group" role="group" aria-label="Schedule type">
                            <div className="schedule-radio-option">
                              <input
                                id={`schedule-type-one-off-${job.id}`}
                                type="radio"
                                name={`schedule-type-${job.id}`}
                                checked={editScheduleType === "one-off"}
                                onChange={() => onEditScheduleTypeChange("one-off")}
                              />
                              <label htmlFor={`schedule-type-one-off-${job.id}`}>One-off</label>
                            </div>
                            <div className="schedule-radio-option">
                              <input
                                id={`schedule-type-repeating-${job.id}`}
                                type="radio"
                                name={`schedule-type-${job.id}`}
                                checked={editScheduleType === "repeating"}
                                onChange={() => onEditScheduleTypeChange("repeating")}
                              />
                              <label htmlFor={`schedule-type-repeating-${job.id}`}>Repeating daily</label>
                            </div>
                          </div>

                          <div className={editErrors.scheduleAt ? "field-shell has-error" : "field-shell"}>
                            <div className="field-row-stacked">
                              <label htmlFor={`schedule-at-${job.id}`}>
                                {editScheduleType === "one-off" ? "Run once at" : "Run daily at"}
                              </label>
                              <input
                                id={`schedule-at-${job.id}`}
                                ref={refs.scheduleAt}
                                aria-invalid={Boolean(editErrors.scheduleAt)}
                                type={editScheduleType === "one-off" ? "datetime-local" : "time"}
                                value={editScheduleType === "one-off" ? editRunAt : editRunTime}
                                onChange={(event) =>
                                  editScheduleType === "one-off"
                                    ? onEditRunAtChange(event.target.value)
                                    : onEditRunTimeChange(event.target.value)
                                }
                              />
                            </div>
                            {editErrors.scheduleAt ? <p className="field-error">{editErrors.scheduleAt}</p> : null}
                          </div>
                        </fieldset>
                      </div>

                      <ProtectionStrategyFields
                        errors={editProtectionErrors}
                        loadingPreview={loadingEditPreview}
                        onChange={onEditProtectionChange}
                        preview={editProtectionPreview}
                        previewError={editProtectionPreviewError}
                        refs={editProtectionRefs}
                        values={editProtectionValues}
                      />

                      <div className="button-row">
                        <button type="submit" className="default" disabled={loadingUpdate}>
                          {loadingUpdate ? <LoadingLabel label="Saving" /> : "Save changes"}
                        </button>
                        <button type="button" className="ghost" onClick={onEditCancel} disabled={loadingUpdate}>
                          Cancel edit
                        </button>
                      </div>
                    </form>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function formatOrderSize(size: number): string {
  if (!Number.isFinite(size)) {
    return "—";
  }

  return Number.isInteger(size) ? String(size) : size.toFixed(2);
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <span className="loading-label">
      <span className="loading-dot" aria-hidden="true" />
      {label}…
    </span>
  );
}
