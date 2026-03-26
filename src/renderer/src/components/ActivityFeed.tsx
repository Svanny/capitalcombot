import type { ExecutionResult } from "@shared/types";
import { formatDateTime } from "../lib/formatters";
import { WindowHelpButton } from "./WindowHelpButton";

interface ActivityFeedProps {
  errorMessage: string | null;
  executionLog: ExecutionResult[];
  statusMessage: string | null;
}

export function ActivityFeed({
  errorMessage,
  executionLog,
  statusMessage,
}: ActivityFeedProps) {
  return (
    <section className="window section-window activity-window">
      <div className="title-bar">
        <div className="title-bar-text">Activity Log</div>
        <div className="title-bar-controls">
          <WindowHelpButton
            title="Activity Log"
            hints={[
              "Connection, selection, order, and close activity appears here.",
              "Errors and successful actions are kept in local execution history.",
            ]}
          />
        </div>
      </div>
      <div className="window-body section-window-body activity-window-body">
        <div className="status-stack" aria-live="polite">
          {statusMessage ? <div className="status-banner success">{statusMessage}</div> : null}
          {errorMessage ? <div className="status-banner error">{errorMessage}</div> : null}
        </div>

        <div className="log-list activity-log-list">
          {executionLog.length === 0 ? (
            <div className="empty-state">
              <strong>No execution history yet.</strong>
              <p>Your connection, selection, order, and close activity will appear here.</p>
            </div>
          ) : (
            executionLog.map((entry) => (
              <article key={`${entry.at}-${entry.message}`} className="log-entry">
                <div className="log-entry-header">
                  <span className={`status-pill status-${entry.status}`}>{entry.action}</span>
                  <time>{formatDateTime(entry.at)}</time>
                </div>
                <strong>{entry.message}</strong>
                {entry.detail ? <p>{entry.detail}</p> : null}
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
