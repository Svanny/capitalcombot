import type { ScheduledOrderJob } from "@shared/types";
import { formatDateTime, formatTime } from "../lib/formatters";
import { WindowHelpButton } from "./WindowHelpButton";

interface SchedulePanelProps {
  loadingCancel: boolean;
  onCancel: (job: ScheduledOrderJob) => Promise<void>;
  schedules: ScheduledOrderJob[];
}

export function SchedulePanel({ loadingCancel, onCancel, schedules }: SchedulePanelProps) {
  return (
    <section className="window section-window schedule-window">
      <div className="title-bar">
        <div className="title-bar-text">Scheduled Orders</div>
        <div className="title-bar-controls">
          <WindowHelpButton
            title="Scheduled Orders"
            hints={[
              "Scheduled orders run only while this desktop app stays open.",
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
            schedules.map((job) => (
              <article key={job.id} className="schedule-card">
                <div>
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
                {job.status === "scheduled" ? (
                  <div className="inline-actions">
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
              </article>
            ))
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
