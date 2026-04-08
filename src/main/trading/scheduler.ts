import { randomUUID } from "node:crypto";
import type {
  OpenPosition,
  ProtectionStrategy,
  ResolvedProtection,
  ScheduledOrderJob,
  ScheduledOrderRequest,
} from "../../shared/types";
import { createAppError } from "./capital/client";
import { buildExecutionResult, type AppStateStore } from "../state/app-store";

export type ScheduledOrderInput = ScheduledOrderRequest & {
  epic: string;
  instrumentName: string;
  direction: "BUY" | "SELL";
  size: number;
  protection?: ProtectionStrategy | null;
};

export type ScheduledOrderUpdateInput = ScheduledOrderRequest & {
  direction: "BUY" | "SELL";
  size: number;
  protection?: ProtectionStrategy | null;
};

export interface SchedulerClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface ScheduledExecutionResult {
  position: OpenPosition | null;
  resolvedProtection: ResolvedProtection | null;
}

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class ScheduledOrderScheduler {
  private readonly timers = new Map<string, unknown>();

  constructor(
    private readonly store: AppStateStore,
    private readonly placeOrder: (job: ScheduledOrderJob) => Promise<ScheduledExecutionResult>,
    private readonly clock: SchedulerClock = systemClock,
  ) {}

  restore(): ScheduledOrderJob[] {
    const restored = assignUniqueJobIds(this.store.getState().schedules)
      .map((job) => this.restoreJob(job))
      .sort(sortJobs);

    this.store.setSchedules(restored);
    return restored;
  }

  list(): ScheduledOrderJob[] {
    return this.store.getState().schedules.slice().sort(sortJobs);
  }

  schedule(input: ScheduledOrderInput): ScheduledOrderJob {
    const scheduledAt = resolveInitialRunAt(input, this.clock.now());

    const job: ScheduledOrderJob = {
      id: buildScheduleId(),
      epic: input.epic,
      instrumentName: input.instrumentName,
      direction: input.direction,
      size: input.size,
      scheduleType: input.type,
      runAt: scheduledAt.toISOString(),
      runTime: input.type === "repeating" ? input.runTime : undefined,
      status: "scheduled",
      createdAt: new Date(this.clock.now()).toISOString(),
      protection: input.protection ?? null,
    };

    const nextSchedules = this.list().concat(job).sort(sortJobs);
    this.store.setSchedules(nextSchedules);
    this.arm(job);
    return job;
  }

  cancel(jobId: string, reason = "Cancelled manually"): ScheduledOrderJob[] {
    const nextSchedules = this.list().map((job) => {
      if (job.id !== jobId || job.status !== "scheduled") {
        return job;
      }

      this.disarm(job.id);
      return {
        ...job,
        status: "cancelled" as const,
        reason,
      };
    });

    this.store.setSchedules(nextSchedules);
    return nextSchedules;
  }

  update(jobId: string, input: ScheduledOrderUpdateInput): ScheduledOrderJob {
    const current = this.list().find((job) => job.id === jobId);

    if (!current) {
      throw createAppError("MISSING_SCHEDULE", "No scheduled order was found to update.", true);
    }

    if (current.status !== "scheduled") {
      throw createAppError(
        "INVALID_SCHEDULE_STATE",
        "Only pending scheduled orders can be edited.",
        true,
      );
    }

    const scheduledAt = resolveInitialRunAt(input, this.clock.now());
    const nextJob: ScheduledOrderJob = {
      ...current,
      direction: input.direction,
      size: input.size,
      scheduleType: input.type,
      runAt: scheduledAt.toISOString(),
      runTime: input.type === "repeating" ? input.runTime : undefined,
      protection: input.protection ?? null,
      reason: undefined,
    };

    this.replaceJob(nextJob);
    this.arm(nextJob);
    return nextJob;
  }

  private restoreJob(job: ScheduledOrderJob): ScheduledOrderJob {
    if (job.status !== "scheduled") {
      return job;
    }

    if (job.scheduleType === "repeating") {
      if (!job.runTime || !isValidRunTime(job.runTime)) {
        return {
          ...job,
          status: "failed",
          reason: "Repeating schedule time is invalid.",
          lastError: "Saved repeating schedule could not be restored.",
        };
      }

      if (new Date(job.runAt).getTime() <= this.clock.now()) {
        const nextRunAt = getNextOccurrenceFromTime(job.runTime, this.clock.now());
        const rescheduledJob = {
          ...job,
          runAt: nextRunAt.toISOString(),
          lastAttemptAt: job.runAt,
          reason: "Missed repeating run while the app was not running. Next run scheduled.",
          lastError: "Missed while the app was not running.",
        };
        this.arm(rescheduledJob);
        return rescheduledJob;
      }

      this.arm(job);
      return job;
    }

    if (new Date(job.runAt).getTime() <= this.clock.now()) {
      return {
        ...job,
        status: "missed",
        reason: "The app was closed when the market order should have been submitted.",
        lastError: "Missed while the app was not running.",
      };
    }

    this.arm(job);
    return job;
  }

  private arm(job: ScheduledOrderJob): void {
    this.disarm(job.id);
    const delayMs = Math.max(new Date(job.runAt).getTime() - this.clock.now(), 0);
    const handle = this.clock.setTimer(() => {
      void this.execute(job.id);
    }, delayMs);
    this.timers.set(job.id, handle);
  }

  private disarm(jobId: string): void {
    const handle = this.timers.get(jobId);

    if (handle) {
      this.clock.clearTimer(handle);
      this.timers.delete(jobId);
    }
  }

  private async execute(jobId: string): Promise<void> {
    this.timers.delete(jobId);
    const schedules = this.list();
    const current = schedules.find((job) => job.id === jobId);

    if (!current || current.status !== "scheduled") {
      return;
    }

    const executing = {
      ...current,
      status: "executing" as const,
      lastAttemptAt: new Date(this.clock.now()).toISOString(),
    };
    this.replaceJob(executing);

    try {
      const { position, resolvedProtection } = await this.placeOrder(executing);

      if (executing.scheduleType === "repeating" && executing.runTime) {
        const nextRunAt = getNextOccurrenceFromTime(executing.runTime, this.clock.now());
        const rescheduledJob: ScheduledOrderJob = {
          ...executing,
          status: "scheduled",
          runAt: nextRunAt.toISOString(),
          lastError: undefined,
          lastOrderDealId: position?.dealId,
          lastResolvedProtection: resolvedProtection,
          reason: "Market order placed. Next repeating run scheduled.",
        };
        this.replaceJob(rescheduledJob);
        this.arm(rescheduledJob);
      } else {
        this.replaceJob({
          ...executing,
          status: "executed",
          lastError: undefined,
          lastOrderDealId: position?.dealId,
          lastResolvedProtection: resolvedProtection,
          reason: "Market order placed automatically at the scheduled time.",
        });
      }

      this.store.appendExecution(
        buildExecutionResult(
          "schedule",
          "success",
          `Scheduled ${executing.direction} order placed for ${executing.instrumentName}.`,
          position ? `Deal ${position.dealId}` : undefined,
        ),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown scheduler error.";

      if (executing.scheduleType === "repeating" && executing.runTime) {
        const nextRunAt = getNextOccurrenceFromTime(executing.runTime, this.clock.now());
        const retriedJob: ScheduledOrderJob = {
          ...executing,
          status: "scheduled",
          runAt: nextRunAt.toISOString(),
          lastError: detail,
          reason: "Automatic order failed. Next repeating run scheduled.",
        };
        this.replaceJob(retriedJob);
        this.arm(retriedJob);
        this.store.appendExecution(
          buildExecutionResult(
            "schedule",
            "error",
            `Scheduled ${executing.direction} order failed for ${executing.instrumentName}.`,
            `${detail} Retrying at the next repeating schedule.`,
          ),
        );
        return;
      }

      this.replaceJob({
        ...executing,
        status: "failed",
        lastError: detail,
        reason: "Automatic market order failed.",
      });
      this.store.appendExecution(
        buildExecutionResult(
          "schedule",
          "error",
          `Scheduled ${executing.direction} order failed for ${executing.instrumentName}.`,
          detail,
        ),
      );
    }
  }

  private replaceJob(nextJob: ScheduledOrderJob): void {
    const nextSchedules = this.list()
      .map((job) => (job.id === nextJob.id ? nextJob : job))
      .sort(sortJobs);
    this.store.setSchedules(nextSchedules);
  }
}

function sortJobs(left: ScheduledOrderJob, right: ScheduledOrderJob): number {
  return new Date(left.runAt).getTime() - new Date(right.runAt).getTime();
}

function buildScheduleId(): string {
  return `schedule_${randomUUID()}`;
}

function assignUniqueJobIds(jobs: ScheduledOrderJob[]): ScheduledOrderJob[] {
  const seenIds = new Set<string>();

  return jobs.map((job) => {
    if (job.id && !seenIds.has(job.id)) {
      seenIds.add(job.id);
      return job;
    }

    const nextJob = {
      ...job,
      id: buildScheduleId(),
    };
    seenIds.add(nextJob.id);
    return nextJob;
  });
}

function resolveInitialRunAt(input: ScheduledOrderRequest, nowMs: number): Date {
  if (input.type === "one-off") {
    const runAt = new Date(input.runAt);

    if (Number.isNaN(runAt.getTime())) {
      throw new Error("Scheduled order time is invalid.");
    }

    if (runAt.getTime() <= nowMs) {
      throw new Error("Scheduled order time must be in the future.");
    }

    return runAt;
  }

  if (!isValidRunTime(input.runTime)) {
    throw new Error("Scheduled order time is invalid.");
  }

  return getNextOccurrenceFromTime(input.runTime, nowMs);
}

function isValidRunTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function getNextOccurrenceFromTime(runTime: string, nowMs: number): Date {
  const [hoursText, minutesText] = runTime.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const next = new Date(nowMs);

  next.setHours(hours, minutes, 0, 0);

  if (next.getTime() <= nowMs) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}
