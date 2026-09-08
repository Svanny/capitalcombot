import type { ScheduledOrderJob } from "./types";

export function isAutomaticTargetPause(job: ScheduledOrderJob): boolean {
  return Boolean(job.targetPosition && job.status === "paused" && (
    job.targetAutoPaused === true ||
    job.reason?.startsWith("Paused because this target-position leg needs no order:") ||
    job.reason?.startsWith("Paused: no order needed.")
  ));
}

export function canCheckSchedule(job: ScheduledOrderJob): boolean {
  return job.status === "scheduled" || isAutomaticTargetPause(job);
}

export function automaticTargetPause(job: ScheduledOrderJob, reason?: string): ScheduledOrderJob {
  return {
    ...job,
    status: "paused",
    targetAutoPaused: true,
    reason: `${reason ?? "No order needed."} Live exposure will be checked at the scheduled time.`,
  };
}

export function restoreTargetPause(job: ScheduledOrderJob): ScheduledOrderJob {
  if (isAutomaticTargetPause(job) || (job.targetPosition && job.status === "scheduled" && (
    job.reason === "Late leg is not needed for a short target." ||
    job.reason?.endsWith("Position already satisfies this leg.")
  ))) {
    return { ...job, status: "paused", targetAutoPaused: true };
  }
  return job;
}
