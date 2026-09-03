import type { OpenPosition, ScheduledOrderJob, TradeDirection } from "./types";

const EDITABLE_STATUSES = new Set<ScheduledOrderJob["status"]>(["scheduled", "paused"]);
const SIZE_PRECISION = 10;

export interface TargetPairEligibility {
  eligible: boolean;
  jobs: ScheduledOrderJob[];
  reason: string | null;
}

export interface TargetTransitionInput {
  currentPosition: number;
  targetDirection: TradeDirection;
  targetSize: number;
  leg: "early" | "late";
  executionTime: Date;
}

export type TargetTransitionPlan =
  | { kind: "noop"; reason: string }
  | { kind: "order"; direction: TradeDirection; size: number; reason: string };

export function getTargetPairEligibility(
  schedules: ScheduledOrderJob[],
  epic: string,
): TargetPairEligibility {
  const jobs = orderTargetPairJobs(
    schedules.filter((job) => job.epic === epic && EDITABLE_STATUSES.has(job.status)),
  );

  if (jobs.length !== 2) {
    return {
      eligible: false,
      jobs,
      reason: "Target position requires exactly two scheduled or paused orders for this market.",
    };
  }

  if (jobs[0].scheduleType !== jobs[1].scheduleType) {
    return {
      eligible: false,
      jobs,
      reason: "Both target-position orders must use the same schedule type.",
    };
  }

  const firstRun = new Date(jobs[0].runAt);
  const secondRun = new Date(jobs[1].runAt);
  const sameExecutionTime = jobs[0].scheduleType === "repeating"
    ? !jobs[0].runTime || !jobs[1].runTime || jobs[0].runTime === jobs[1].runTime
    : firstRun.getTime() === secondRun.getTime();
  if (
    Number.isNaN(firstRun.getTime()) ||
    Number.isNaN(secondRun.getTime()) ||
    sameExecutionTime
  ) {
    return {
      eligible: false,
      jobs,
      reason: "Target-position orders must have two distinct valid execution times.",
    };
  }

  if (
    jobs[0].scheduleType === "one-off" &&
    localDateKey(firstRun) !== localDateKey(secondRun)
  ) {
    return {
      eligible: false,
      jobs,
      reason: "One-off target-position orders must run on the same local date.",
    };
  }

  return { eligible: true, jobs, reason: null };
}

export function orderTargetPairJobs(jobs: ScheduledOrderJob[]): ScheduledOrderJob[] {
  return jobs.slice().sort(compareTargetPairJobs);
}

export function aggregateSignedPosition(positions: OpenPosition[], epic: string): number {
  return roundSize(
    positions
      .filter((position) => position.epic === epic)
      .reduce(
        (total, position) => total + (position.direction === "BUY" ? position.size : -position.size),
        0,
      ),
  );
}

export function planTargetTransition(input: TargetTransitionInput): TargetTransitionPlan {
  const day = input.executionTime.getDay();
  if (day === 0) {
    return { kind: "noop", reason: "Weekend target-position leg skipped." };
  }

  const target = input.targetDirection === "BUY" ? input.targetSize : -input.targetSize;
  let delta = 0;
  let reason = "";

  if (day === 6) {
    if (input.leg === "late") {
      return { kind: "noop", reason: "Saturday late target-position leg skipped after the Friday close." };
    }
    delta = -input.currentPosition;
    reason = "Friday-close target-position flatten on the Saturday early leg.";
  } else if (input.leg === "early") {
    if (target < 0) {
      delta = target - input.currentPosition;
      reason = "Early target-position move to short exposure.";
    } else {
      delta = -input.currentPosition;
      reason = "Early target-position flatten before long entry.";
    }
  } else if (target > 0) {
    delta = target - input.currentPosition;
    reason = "Late target-position move to long exposure.";
  } else {
    return { kind: "noop", reason: "Late leg is not needed for a short target." };
  }

  delta = roundSize(delta);
  if (delta === 0) {
    return { kind: "noop", reason: `${reason} Position already satisfies this leg.` };
  }

  return {
    kind: "order",
    direction: delta > 0 ? "BUY" : "SELL",
    size: Math.abs(delta),
    reason,
  };
}

function compareTargetPairJobs(left: ScheduledOrderJob, right: ScheduledOrderJob): number {
  if (
    left.scheduleType === "repeating" &&
    right.scheduleType === "repeating" &&
    left.runTime &&
    right.runTime
  ) {
    return left.runTime.localeCompare(right.runTime);
  }

  return new Date(left.runAt).getTime() - new Date(right.runAt).getTime();
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function roundSize(value: number): number {
  return Number(value.toFixed(SIZE_PRECISION));
}
