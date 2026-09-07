import { randomUUID } from "node:crypto";
import type {
  OpenPosition,
  ProtectionStrategy,
  ResolvedProtection,
  ScheduledOrderJob,
  ScheduledOrderRequest,
  ScheduledTargetPositionUpdate,
} from "../../shared/types";
import {
  getTargetPairEligibility,
  orderTargetPairJobs,
  planTargetTransition,
  type TargetTransitionPlan,
} from "../../shared/target-position";
import { createAppError, normalizeError } from "./capital/client";
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
  targetPosition?: ScheduledTargetPositionUpdate;
  targetCurrentPosition?: number;
};

export interface SchedulerClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface ScheduledExecutionResult {
  position: OpenPosition | null;
  resolvedProtection: ResolvedProtection | null;
  reason?: string;
  noOrderNeeded?: boolean;
}

export interface RestoreOptions {
  armScheduled?: boolean;
}

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const TARGET_NO_ORDER_PAUSE_PREFIX = "Paused because this target-position leg needs no order:";

export class ScheduledOrderScheduler {
  private readonly timers = new Map<string, unknown>();

  constructor(
    private readonly store: AppStateStore,
    private readonly placeOrder: (job: ScheduledOrderJob) => Promise<ScheduledExecutionResult>,
    private readonly clock: SchedulerClock = systemClock,
  ) {}

  restore(options: RestoreOptions = {}): ScheduledOrderJob[] {
    const armScheduled = options.armScheduled ?? true;
    const restored = assignUniqueJobIds(this.store.getState().schedules)
      .map((job) => this.restoreJob(clearLegacyTargetPause(job), armScheduled))
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
    const current = this.list().find((job) => job.id === jobId);
    if (current?.targetPosition) {
      throw createAppError(
        "INVALID_SCHEDULE_STATE",
        "Disable target-position mode before cancelling either paired order.",
        true,
      );
    }

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

  pause(jobId: string, reason = "Paused manually"): ScheduledOrderJob[] {
    const current = this.list().find((job) => job.id === jobId);

    if (!current) {
      throw createAppError("MISSING_SCHEDULE", "No scheduled order was found to pause.", true);
    }

    if (current.status !== "scheduled") {
      throw createAppError(
        "INVALID_SCHEDULE_STATE",
        "Only pending scheduled orders can be paused.",
        true,
      );
    }

    this.disarm(current.id);
    const nextSchedules = this.list().map((job) =>
      job.id === jobId
        ? {
            ...job,
            status: "paused" as const,
            reason,
          }
        : job,
    );

    this.store.setSchedules(nextSchedules);
    return nextSchedules;
  }

  reactivate(jobId: string): ScheduledOrderJob {
    const current = this.list().find((job) => job.id === jobId);

    if (!current) {
      throw createAppError("MISSING_SCHEDULE", "No scheduled order was found to reactivate.", true);
    }

    if (current.status !== "paused" && current.status !== "cancelled") {
      throw createAppError(
        "INVALID_SCHEDULE_STATE",
        "Only paused or cancelled scheduled orders can be reactivated.",
        true,
      );
    }

    const nowMs = this.clock.now();
    let nextJob: ScheduledOrderJob;

    if (current.scheduleType === "repeating") {
      if (!current.runTime || !isValidRunTime(current.runTime)) {
        throw createAppError(
          "INVALID_SCHEDULE_STATE",
          "Repeating schedule time is invalid. Edit the scheduled order before reactivating it.",
          true,
        );
      }

      nextJob = {
        ...current,
        status: "scheduled",
        runAt: getNextOccurrenceFromTime(current.runTime, nowMs).toISOString(),
        reason: "Scheduled order reactivated.",
        lastError: undefined,
      };
    } else {
      if (new Date(current.runAt).getTime() <= nowMs) {
        throw createAppError(
          "INVALID_SCHEDULE_STATE",
          "Edit this one-off scheduled order to a future time before reactivating it.",
          true,
        );
      }

      nextJob = {
        ...current,
        status: "scheduled",
        reason: "Scheduled order reactivated.",
        lastError: undefined,
      };
    }

    this.replaceJob(nextJob);
    this.arm(nextJob);
    return nextJob;
  }

  armScheduledJobs(): ScheduledOrderJob[] {
    const schedules = this.list();

    schedules
      .filter((job) => job.status === "scheduled")
      .forEach((job) => this.arm(job));

    return schedules;
  }

  update(jobId: string, input: ScheduledOrderUpdateInput): ScheduledOrderJob {
    const current = this.list().find((job) => job.id === jobId);

    if (!current) {
      throw createAppError("MISSING_SCHEDULE", "No scheduled order was found to update.", true);
    }

    if (current.status !== "scheduled" && current.status !== "paused") {
      throw createAppError(
        "INVALID_SCHEDULE_STATE",
        "Only scheduled or paused orders can be edited.",
        true,
      );
    }

    const scheduledAt = resolveInitialRunAt(input, this.clock.now());
    const editedJob: ScheduledOrderJob = {
      ...current,
      scheduleType: input.type,
      runAt: scheduledAt.toISOString(),
      runTime: input.type === "repeating" ? input.runTime : undefined,
      reason: undefined,
    };

    const targetPositionUpdate = input.targetPosition;
    if (targetPositionUpdate?.enabled) {
      if (!Number.isFinite(input.targetCurrentPosition)) {
        throw createAppError(
          "TARGET_POSITION_UNAVAILABLE",
          "The live position could not be confirmed before updating the target-position pair.",
          true,
        );
      }
      const candidateSchedules = this.list().map((job) => (job.id === jobId ? editedJob : job));
      const eligibility = getTargetPairEligibility(candidateSchedules, current.epic);
      if (!eligibility.eligible) {
        throw createAppError(
          "INVALID_TARGET_POSITION_PAIR",
          eligibility.reason ?? "The target-position pair is invalid.",
          true,
        );
      }

      const existingPairIds = new Set(
        eligibility.jobs.map((job) => job.targetPosition?.pairId).filter(Boolean),
      );
      const pairId = existingPairIds.size === 1
        ? ([...existingPairIds][0] as string)
        : `target_${randomUUID()}`;
      const pairJobIds = new Set(eligibility.jobs.map((job) => job.id));
      const jobsByTime = alignRepeatingTargetCycle(orderTargetPairJobs(eligibility.jobs));
      let projectedPosition = input.targetCurrentPosition!;
      const plannedJobs = new Map<string, ScheduledOrderJob>();
      jobsByTime.forEach((job, index) => {
        const leg = index === 0 ? "early" : "late";
        const plan = planTargetTransition({
          currentPosition: projectedPosition,
          targetDirection: targetPositionUpdate.direction,
          targetSize: targetPositionUpdate.size,
          leg,
          executionTime: new Date(job.runAt),
        });
        plannedJobs.set(
          job.id,
          createTargetPairJob(job, pairId, leg, targetPositionUpdate.direction, targetPositionUpdate.size, plan),
        );
        if (plan.kind === "order") {
          projectedPosition += plan.direction === "BUY" ? plan.size : -plan.size;
        }
      });
      const nextSchedules = candidateSchedules.map((job) =>
        pairJobIds.has(job.id) ? plannedJobs.get(job.id)! : job,
      );

      this.replaceJobs(nextSchedules, pairJobIds);
      return nextSchedules.find((job) => job.id === jobId)!;
    }

    if (current.targetPosition && targetPositionUpdate === undefined) {
      const fixedEdit = {
        ...editedJob,
        direction: input.direction,
        size: input.size,
        protection: input.protection ?? null,
      };
      const candidateSchedules = this.list().map((job) => (job.id === jobId ? fixedEdit : job));
      const eligibility = getTargetPairEligibility(candidateSchedules, current.epic);
      const pairId = current.targetPosition.pairId;
      if (
        !eligibility.eligible ||
        !eligibility.jobs.every((job) => job.targetPosition?.pairId === pairId)
      ) {
        throw createAppError(
          "INVALID_TARGET_POSITION_PAIR",
          eligibility.reason ?? "Disable target-position mode before changing the pair structure.",
          true,
        );
      }

      const jobsByTime = orderTargetPairJobs(eligibility.jobs);
      const legById = new Map(
        jobsByTime.map((job, index) => [job.id, index === 0 ? "early" : "late"] as const),
      );
      const affectedIds = new Set(eligibility.jobs.map((job) => job.id));
      const nextSchedules = candidateSchedules.map((job) =>
        affectedIds.has(job.id)
          ? {
              ...job,
              targetPosition: {
                ...current.targetPosition!,
                leg: legById.get(job.id)!,
              },
            }
          : job,
      );

      this.replaceJobs(nextSchedules, affectedIds);
      return nextSchedules.find((job) => job.id === jobId)!;
    }

    const pairId = current.targetPosition?.pairId;
    const nextJob: ScheduledOrderJob = {
      ...editedJob,
      direction: input.direction,
      size: input.size,
      protection: input.protection ?? null,
      targetPosition: null,
    };
    const affectedIds = new Set<string>([jobId]);
    const nextSchedules = this.list().map((job) => {
      if (job.id === jobId) {
        return nextJob;
      }
      if (pairId && job.targetPosition?.pairId === pairId) {
        affectedIds.add(job.id);
        return { ...job, targetPosition: null };
      }
      return job;
    });

    this.replaceJobs(nextSchedules, affectedIds);
    return nextJob;
  }

  private restoreJob(job: ScheduledOrderJob, armScheduled: boolean): ScheduledOrderJob {
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
        if (armScheduled) {
          this.arm(rescheduledJob);
        }
        return rescheduledJob;
      }

      if (armScheduled) {
        this.arm(job);
      }
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

    if (armScheduled) {
      this.arm(job);
    }
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
      const { position, resolvedProtection, reason, noOrderNeeded } = await this.placeOrder(executing);

      if (executing.targetPosition && noOrderNeeded) {
        const pauseReason = `Paused: no order needed. ${reason ?? "Target position is already satisfied."}`;
        this.replaceJob({
          ...executing,
          status: "paused",
          lastError: undefined,
          reason: pauseReason,
        });
        this.store.appendExecution(buildExecutionResult("schedule", "info", pauseReason));
        return;
      }

      if (executing.scheduleType === "repeating" && executing.runTime) {
        const nextRunAt = getNextOccurrenceFromTime(executing.runTime, this.clock.now());
        const rescheduledJob: ScheduledOrderJob = {
          ...executing,
          status: "scheduled",
          runAt: nextRunAt.toISOString(),
          lastError: undefined,
          lastOrderDealId: position?.dealId,
          lastResolvedProtection: resolvedProtection,
          reason: reason ?? "Market order placed. Next repeating run scheduled.",
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
          reason: reason ?? "Market order placed automatically at the scheduled time.",
        });
      }

      this.store.appendExecution(
        buildExecutionResult(
          "schedule",
          "success",
          reason ?? `Scheduled ${executing.direction} order placed for ${executing.instrumentName}.`,
          position ? `Deal ${position.dealId}` : undefined,
        ),
      );
    } catch (error) {
      const failure = normalizeError(error);
      const detail = failure.detail
        ? `${failure.message} [${failure.code}] ${failure.detail}`
        : failure.message;

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

  private replaceJobs(nextSchedules: ScheduledOrderJob[], affectedIds: Set<string>): void {
    affectedIds.forEach((jobId) => this.disarm(jobId));
    const sortedSchedules = nextSchedules.slice().sort(sortJobs);
    this.store.setSchedules(sortedSchedules);
    sortedSchedules
      .filter((job) => affectedIds.has(job.id) && job.status === "scheduled")
      .forEach((job) => this.arm(job));
  }
}

function sortJobs(left: ScheduledOrderJob, right: ScheduledOrderJob): number {
  return new Date(left.runAt).getTime() - new Date(right.runAt).getTime();
}

function alignRepeatingTargetCycle(jobs: ScheduledOrderJob[]): ScheduledOrderJob[] {
  if (jobs.length !== 2 || jobs.some((job) => job.scheduleType !== "repeating" || !job.runTime)) {
    return jobs;
  }

  const cycleDate = new Date(jobs[0].runAt);
  return jobs.map((job) => {
    const [hours, minutes] = job.runTime!.split(":").map(Number);
    const alignedRun = new Date(cycleDate);
    alignedRun.setHours(hours, minutes, 0, 0);
    return { ...job, runAt: alignedRun.toISOString() };
  });
}

function createTargetPairJob(
  job: ScheduledOrderJob,
  pairId: string,
  leg: "early" | "late",
  direction: "BUY" | "SELL",
  size: number,
  plan: TargetTransitionPlan,
): ScheduledOrderJob {
  return {
    ...clearLegacyTargetPause(job),
    direction: plan.kind === "order" ? plan.direction : job.direction,
    size: plan.kind === "order" ? plan.size : job.size,
    targetPosition: {
      pairId,
      leg,
      direction,
      size,
    },
  };
}

function clearLegacyTargetPause(job: ScheduledOrderJob): ScheduledOrderJob {
  if (job.targetPosition && job.status === "paused" && job.reason?.startsWith(TARGET_NO_ORDER_PAUSE_PREFIX)) {
    return { ...job, status: "scheduled", reason: undefined };
  }
  return job;
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
