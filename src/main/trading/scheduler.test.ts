import { describe, expect, it, vi } from "vitest";
import type { OpenPosition } from "../../shared/types";
import { MemoryAppStateStore } from "../state/app-store";
import { ScheduledOrderScheduler, type SchedulerClock } from "./scheduler";

class FakeClock implements SchedulerClock {
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  private idCounter = 0;

  constructor(private current = Date.parse("2026-03-23T10:00:00.000Z")) {}

  now(): number {
    return this.current;
  }

  setTimer(callback: () => void, delayMs: number): unknown {
    const id = ++this.idCounter;
    this.timers.set(id, {
      at: this.current + delayMs,
      callback,
    });
    return id;
  }

  clearTimer(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  async advanceTo(nextTime: string): Promise<void> {
    this.current = Date.parse(nextTime);
    const ready = [...this.timers.entries()]
      .filter(([, timer]) => timer.at <= this.current)
      .sort((left, right) => left[1].at - right[1].at);

    ready.forEach(([id, timer]) => {
      this.timers.delete(id);
      timer.callback();
    });

    await Promise.resolve();
  }
}

describe("ScheduledOrderScheduler", () => {
  function buildOpenPosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
    return {
      dealId: "deal-1",
      dealReference: "ref-1",
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      level: 3010.5,
      currency: "USD",
      pnl: 0,
      bid: 3010.1,
      ask: 3010.8,
      createdAt: "2026-03-23T10:30:00.000Z",
      stopLevel: null,
      profitLevel: null,
      ...overrides,
    };
  }

  it("creates a scheduled order and executes it later", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: buildOpenPosition(),
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });

    expect(job.status).toBe("scheduled");
    await clock.advanceTo("2026-03-23T10:29:59.000Z");
    expect(placeSpy).not.toHaveBeenCalled();

    await clock.advanceTo("2026-03-23T10:30:00.000Z");

    expect(placeSpy).toHaveBeenCalledWith(expect.objectContaining({ epic: "XAUUSD", direction: "BUY" }));
    expect(store.getState().schedules[0]?.status).toBe("executed");
  });

  it("restores future one-off jobs after restart", () => {
    const store = new MemoryAppStateStore();
    store.setSchedules([
      {
        id: "schedule_1",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "one-off",
        runAt: "2026-03-23T11:00:00.000Z",
        status: "scheduled",
        createdAt: "2026-03-23T10:00:00.000Z",
      },
    ]);
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const restored = scheduler.restore();

    expect(restored[0]?.status).toBe("scheduled");
  });

  it("can restore pending jobs without arming them until startup review passes", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: buildOpenPosition(),
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    store.setSchedules([
      {
        id: "schedule_1",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "one-off",
        runAt: "2026-03-23T10:30:00.000Z",
        status: "scheduled",
        createdAt: "2026-03-23T10:00:00.000Z",
      },
    ]);
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);

    const restored = scheduler.restore({ armScheduled: false });

    expect(restored[0]?.status).toBe("scheduled");
    await clock.advanceTo("2026-03-23T10:30:00.000Z");
    expect(placeSpy).not.toHaveBeenCalled();

    scheduler.armScheduledJobs();
    await clock.advanceTo("2026-03-23T10:30:00.000Z");

    expect(placeSpy).toHaveBeenCalledTimes(1);
    expect(store.getState().schedules[0]?.status).toBe("executed");
  });

  it("marks missed one-off jobs when the app was closed past the run time", () => {
    const store = new MemoryAppStateStore();
    store.setSchedules([
      {
        id: "schedule_1",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "one-off",
        runAt: "2026-03-23T09:30:00.000Z",
        status: "scheduled",
        createdAt: "2026-03-23T08:00:00.000Z",
      },
    ]);
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const restored = scheduler.restore();

    expect(restored[0]?.status).toBe("missed");
    expect(restored[0]?.lastError).toContain("Missed");
  });

  it("schedules repeating jobs for the next daily occurrence", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "SELL",
      size: 1.5,
      type: "repeating",
      runTime: "10:30",
    });

    expect(job.scheduleType).toBe("repeating");
    const nextRun = new Date(job.runAt);
    expect(nextRun.getHours()).toBe(10);
    expect(nextRun.getMinutes()).toBe(30);
    expect(nextRun.getTime()).toBeGreaterThan(Date.parse("2026-03-23T10:00:00.000Z"));
  });

  it("keeps repeating jobs scheduled after a successful run", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: null,
      resolvedProtection: {
        referencePrice: 3010.8,
        stopLevel: 3000.8,
        profitLevel: 3030.8,
        stopDistance: 10,
        profitDistance: 20,
      },
    }));
    const clock = new FakeClock();
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "10:30",
    });

    await clock.advanceTo(job.runAt);

    expect(placeSpy).toHaveBeenCalledTimes(1);
    expect(store.getState().schedules[0]?.status).toBe("scheduled");
    expect(store.getState().schedules[0]?.reason).toContain("Next repeating run");
    expect(store.getState().schedules[0]?.lastResolvedProtection?.profitLevel).toBe(3030.8);
  });

  it.each(["one-off", "repeating"] as const)(
    "preserves broker rejection details for a %s target leg",
    async (scheduleType) => {
      const store = new MemoryAppStateStore();
      const clock = new FakeClock();
      const placeSpy = vi.fn(async () => {
        throw {
          code: "CAPITAL_400",
          message: "Capital.com request failed.",
          recoverable: false,
          detail: "error.market.closed apiKey=secret-value",
        };
      });
      const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);
      const job = scheduler.schedule({
        epic: "GOLD",
        instrumentName: "Gold",
        direction: "SELL",
        size: 1.33,
        ...(scheduleType === "one-off"
          ? { type: "one-off" as const, runAt: "2026-03-23T10:30:00.000Z" }
          : { type: "repeating" as const, runTime: "05:30" }),
      });
      store.setSchedules([{
        ...job,
        targetPosition: { pairId: "pair", leg: "late", direction: "SELL", size: 1.33 },
      }]);

      await clock.advanceTo(job.runAt);

      const expectedError = "Capital.com request failed. [CAPITAL_400] error.market.closed apiKey=****";
      const state = store.getState();
      expect(placeSpy).toHaveBeenCalledTimes(1);
      expect(state.schedules[0]).toMatchObject({
        status: scheduleType === "repeating" ? "scheduled" : "failed",
        lastError: expectedError,
      });
      expect(state.executionLog[0]).toMatchObject({ status: "error" });
      expect(state.executionLog[0].detail).toContain(expectedError);
      expect(JSON.stringify(state)).not.toContain("secret-value");
      if (scheduleType === "repeating") {
        expect(new Date(state.schedules[0].runAt).getTime()).toBeGreaterThan(clock.now());
      }
    },
  );

  it("cancels a scheduled job before it fires", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: null,
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });

    scheduler.cancel(job.id);
    await clock.advanceTo("2026-03-23T10:30:00.000Z");

    expect(placeSpy).not.toHaveBeenCalled();
    expect(store.getState().schedules[0]?.status).toBe("cancelled");
  });

  it("pauses a scheduled one-off job before it fires", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: null,
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });

    scheduler.pause(job.id);
    await clock.advanceTo("2026-03-23T10:30:00.000Z");

    expect(placeSpy).not.toHaveBeenCalled();
    expect(store.getState().schedules[0]?.status).toBe("paused");
    expect(store.getState().schedules[0]?.reason).toBe("Paused manually");
  });

  it("does not arm paused jobs during restore or startup arming", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: null,
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    store.setSchedules([
      {
        id: "schedule_1",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "one-off",
        runAt: "2026-03-23T10:30:00.000Z",
        status: "paused",
        createdAt: "2026-03-23T10:00:00.000Z",
      },
    ]);
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);

    scheduler.restore();
    scheduler.armScheduledJobs();
    await clock.advanceTo("2026-03-23T10:30:00.000Z");

    expect(placeSpy).not.toHaveBeenCalled();
    expect(store.getState().schedules[0]?.status).toBe("paused");
  });

  it.each([
    "Paused because this target-position leg needs no order: Saturday late target-position leg skipped after the Friday close.",
    "Paused: no order needed. Position already satisfies this leg.",
  ])("recovers automatic target pauses while preserving manual pauses: %s", async (reason) => {
    const store = new MemoryAppStateStore();
    const clock = new FakeClock();
    const placeSpy = vi.fn(async () => ({ position: null, resolvedProtection: null }));
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);
    const base = scheduler.schedule({
      epic: "XAUUSD", instrumentName: "Spot Gold", direction: "BUY", size: 1,
      type: "one-off", runAt: "2026-03-23T10:30:00.000Z",
    });
    store.setSchedules([
      {
        ...base, status: "paused",
        reason,
        targetPosition: { pairId: "pair", leg: "late", direction: "BUY", size: 1 },
      },
      {
        ...base, id: "manual", status: "paused", reason: "Paused manually",
        targetPosition: { pairId: "pair", leg: "early", direction: "BUY", size: 1 },
      },
    ]);
    scheduler.restore({ armScheduled: false });
    expect(scheduler.list().find((job) => job.id === base.id))
      .toMatchObject({ status: "paused", targetAutoPaused: true });
    expect(scheduler.list().find((job) => job.id === "manual"))
      .toMatchObject({ status: "paused", reason: "Paused manually" });
    scheduler.armScheduledJobs();
    await clock.advanceTo("2026-03-23T10:30:00.000Z");
    expect(placeSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    "Late leg is not needed for a short target.",
    "Late target-position move to long exposure. Position already satisfies this leg.",
  ])("keeps a saved no-op target leg scheduled on restore: %s", async (reason) => {
    const store = new MemoryAppStateStore();
    const clock = new FakeClock();
    const placeSpy = vi.fn(async () => ({ position: null, resolvedProtection: null }));
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);
    const job = scheduler.schedule({
      epic: "GOLD", instrumentName: "Gold", direction: "SELL", size: 1.33,
      type: "repeating", runTime: "05:30",
    });
    store.setSchedules([{ ...job, reason,
      targetPosition: { pairId: "pair", leg: "late", direction: "SELL", size: 1.33 },
    }]);
    scheduler.restore();
    scheduler.armScheduledJobs();
    expect(scheduler.list()[0]).toMatchObject({ status: "paused", targetAutoPaused: true, reason });
    await clock.advanceTo(job.runAt);
    expect(placeSpy).toHaveBeenCalledTimes(1);
    const nextRun = scheduler.list()[0].runAt;
    scheduler.restore();
    await clock.advanceTo(nextRun);
    expect(placeSpy).toHaveBeenCalledTimes(2);
  });

  it("reactivates a paused future one-off job", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: buildOpenPosition(),
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);
    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });
    scheduler.pause(job.id);

    const reactivated = scheduler.reactivate(job.id);
    await clock.advanceTo("2026-03-23T10:30:00.000Z");

    expect(reactivated.status).toBe("scheduled");
    expect(reactivated.runAt).toBe("2026-03-23T10:30:00.000Z");
    expect(placeSpy).toHaveBeenCalledTimes(1);
    expect(store.getState().schedules[0]?.status).toBe("executed");
  });

  it("reactivates a cancelled future one-off job", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: buildOpenPosition(),
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);
    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "SELL",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });
    scheduler.cancel(job.id);

    scheduler.reactivate(job.id);
    await clock.advanceTo("2026-03-23T10:30:00.000Z");

    expect(placeSpy).toHaveBeenCalledWith(expect.objectContaining({ direction: "SELL" }));
    expect(store.getState().schedules[0]?.status).toBe("executed");
  });

  it("reactivates repeating jobs at the next occurrence", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );
    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "09:15",
    });
    scheduler.cancel(job.id);

    const reactivated = scheduler.reactivate(job.id);

    expect(reactivated.status).toBe("scheduled");
    expect(reactivated.runTime).toBe("09:15");
    const nextRun = new Date(reactivated.runAt);
    expect(nextRun.getHours()).toBe(9);
    expect(nextRun.getMinutes()).toBe(15);
    expect(nextRun.getTime()).toBeGreaterThan(Date.parse("2026-03-23T10:00:00.000Z"));
  });

  it("rejects reactivating stale one-off jobs", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: null,
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    store.setSchedules([
      {
        id: "schedule_1",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "one-off",
        runAt: "2026-03-23T09:30:00.000Z",
        status: "cancelled",
        createdAt: "2026-03-23T09:00:00.000Z",
      },
    ]);
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);

    expect(() => scheduler.reactivate("schedule_1")).toThrow(/future time/i);
    await clock.advanceTo("2026-03-23T10:30:00.000Z");
    expect(placeSpy).not.toHaveBeenCalled();
    expect(store.getState().schedules[0]?.status).toBe("cancelled");
  });

  it("rejects pause and reactivate from invalid states", () => {
    const terminalStatuses = ["executing", "executed", "failed", "missed", "cancelled"] as const;

    terminalStatuses.forEach((status) => {
      const store = new MemoryAppStateStore();
      store.setSchedules([
        {
          id: `schedule_${status}`,
          epic: "XAUUSD",
          instrumentName: "Spot Gold",
          direction: "BUY",
          size: 1,
          scheduleType: "one-off",
          runAt: "2026-03-23T10:30:00.000Z",
          status,
          createdAt: "2026-03-23T10:00:00.000Z",
        },
      ]);
      const scheduler = new ScheduledOrderScheduler(
        store,
        async () => ({ position: null, resolvedProtection: null }),
        new FakeClock(),
      );

      expect(() => scheduler.pause(`schedule_${status}`)).toThrow(/pending scheduled orders/i);
    });

    const nonReactivatableStatuses = ["scheduled", "executing", "executed", "failed", "missed"] as const;
    nonReactivatableStatuses.forEach((status) => {
      const store = new MemoryAppStateStore();
      store.setSchedules([
        {
          id: `schedule_${status}`,
          epic: "XAUUSD",
          instrumentName: "Spot Gold",
          direction: "BUY",
          size: 1,
          scheduleType: "one-off",
          runAt: "2026-03-23T10:30:00.000Z",
          status,
          createdAt: "2026-03-23T10:00:00.000Z",
        },
      ]);
      const scheduler = new ScheduledOrderScheduler(
        store,
        async () => ({ position: null, resolvedProtection: null }),
        new FakeClock(),
      );

      expect(() => scheduler.reactivate(`schedule_${status}`)).toThrow(/paused or cancelled/i);
    });

    const scheduler = new ScheduledOrderScheduler(
      new MemoryAppStateStore(),
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );
    expect(() => scheduler.pause("missing")).toThrow(/No scheduled order/);
    expect(() => scheduler.reactivate("missing")).toThrow(/No scheduled order/);
  });

  it("keeps protection strategy config on scheduled jobs until execution", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
      protection: {
        stopLoss: { mode: "distance", distance: 10 },
        takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
      },
    });

    expect(job.protection).toEqual({
      stopLoss: { mode: "distance", distance: 10 },
      takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
    });
  });

  it("updates a one-off job in place and preserves identity", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
      protection: {
        stopLoss: { mode: "distance", distance: 10 },
        takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
      },
    });

    const updated = scheduler.update(job.id, {
      direction: "SELL",
      size: 2,
      type: "one-off",
      runAt: "2026-03-23T11:45:00.000Z",
      protection: null,
    });

    expect(updated.id).toBe(job.id);
    expect(updated.createdAt).toBe(job.createdAt);
    expect(updated.direction).toBe("SELL");
    expect(updated.size).toBe(2);
    expect(updated.runAt).toBe("2026-03-23T11:45:00.000Z");
    expect(updated.protection).toBeNull();
    expect(updated.reason).toBeUndefined();
  });

  it("recomputes repeating runAt when editing a repeating job", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "10:30",
    });

    const updated = scheduler.update(job.id, {
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "14:15",
      protection: null,
    });

    expect(updated.scheduleType).toBe("repeating");
    expect(updated.runTime).toBe("14:15");
    const nextRun = new Date(updated.runAt);
    expect(nextRun.getHours()).toBe(14);
    expect(nextRun.getMinutes()).toBe(15);
  });

  it("keeps matching schedules independently editable by assigning unique ids", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const first = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "10:30",
    });
    const second = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "10:30",
    });

    expect(first.id).not.toBe(second.id);

    scheduler.update(first.id, {
      direction: "SELL",
      size: 2,
      type: "repeating",
      runTime: "14:15",
      protection: null,
    });

    const updatedSchedules = store.getState().schedules;
    const updatedFirst = updatedSchedules.find((job) => job.id === first.id);
    const untouchedSecond = updatedSchedules.find((job) => job.id === second.id);
    expect(updatedFirst?.id).toBe(first.id);
    expect(updatedFirst?.direction).toBe("SELL");
    expect(updatedFirst?.size).toBe(2);
    expect(updatedFirst?.runTime).toBe("14:15");
    expect(untouchedSecond?.id).toBe(second.id);
    expect(untouchedSecond?.direction).toBe("BUY");
    expect(untouchedSecond?.size).toBe(1);
    expect(untouchedSecond?.runTime).toBe("10:30");
  });

  it("repairs duplicate persisted ids during restore", () => {
    const store = new MemoryAppStateStore();
    store.setSchedules([
      {
        id: "schedule_duplicate",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "repeating",
        runAt: "2026-03-23T10:30:00.000Z",
        runTime: "10:30",
        status: "scheduled",
        createdAt: "2026-03-23T10:00:00.000Z",
      },
      {
        id: "schedule_duplicate",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "repeating",
        runAt: "2026-03-23T11:30:00.000Z",
        runTime: "11:30",
        status: "scheduled",
        createdAt: "2026-03-23T10:05:00.000Z",
      },
    ]);
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const restored = scheduler.restore();

    expect(restored).toHaveLength(2);
    expect(restored[0]?.id).not.toBe(restored[1]?.id);
    expect(new Set(restored.map((job) => job.id)).size).toBe(2);
  });

  it("executes restored schedules after repairing duplicate ids", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({
      position: null,
      resolvedProtection: null,
    }));
    const clock = new FakeClock();
    store.setSchedules([
      {
        id: "schedule_duplicate",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "one-off",
        runAt: "2026-03-23T10:30:00.000Z",
        status: "scheduled",
        createdAt: "2026-03-23T10:00:00.000Z",
      },
      {
        id: "schedule_duplicate",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "SELL",
        size: 1,
        scheduleType: "one-off",
        runAt: "2026-03-23T10:31:00.000Z",
        status: "scheduled",
        createdAt: "2026-03-23T10:05:00.000Z",
      },
    ]);
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);

    const restored = scheduler.restore();

    expect(new Set(restored.map((job) => job.id)).size).toBe(2);

    await clock.advanceTo("2026-03-23T10:30:00.000Z");
    await clock.advanceTo("2026-03-23T10:31:00.000Z");

    expect(placeSpy).toHaveBeenCalledTimes(2);
    expect(placeSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ direction: "BUY" }));
    expect(placeSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ direction: "SELL" }));
    expect(store.getState().schedules.every((job) => job.status === "executed")).toBe(true);
  });

  it("rejects updates for invalid or non-pending jobs", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );

    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });

    expect(() =>
      scheduler.update(job.id, {
        direction: "BUY",
        size: 1,
        type: "one-off",
        runAt: "2026-03-23T09:00:00.000Z",
        protection: null,
      }),
    ).toThrow(/future/i);

    scheduler.cancel(job.id);

    expect(() =>
      scheduler.update(job.id, {
        direction: "BUY",
        size: 1,
        type: "repeating",
        runTime: "10:30",
        protection: null,
      }),
    ).toThrow(/scheduled or paused orders/i);

    expect(() =>
      scheduler.update("missing", {
        direction: "BUY",
        size: 1,
        type: "repeating",
        runTime: "10:30",
        protection: null,
      }),
    ).toThrow(/No scheduled order/i);
  });

  it("atomically enables a target pair and preserves scheduled and paused timer state", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({ position: null, resolvedProtection: null }));
    const clock = new FakeClock();
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);
    const early = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });
    const late = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "SELL",
      size: 4,
      type: "one-off",
      runAt: "2026-03-23T11:30:00.000Z",
    });
    scheduler.pause(late.id);

    scheduler.update(early.id, {
      direction: "SELL",
      size: 3,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
      protection: null,
      targetPosition: { enabled: true, direction: "SELL", size: 3 },
      targetCurrentPosition: 0,
    });

    const [storedEarly, storedLate] = scheduler.list();
    expect(storedEarly).toMatchObject({
      id: early.id,
      direction: "SELL",
      size: 3,
      status: "scheduled",
      targetPosition: { leg: "early", direction: "SELL", size: 3 },
    });
    expect(storedLate).toMatchObject({
      id: late.id,
      direction: "SELL",
      size: 4,
      status: "paused",
      targetPosition: { leg: "late", direction: "SELL", size: 3 },
    });
    expect(storedEarly.targetPosition?.pairId).toBe(storedLate.targetPosition?.pairId);

    await clock.advanceTo("2026-03-23T11:31:00.000Z");
    expect(placeSpy).toHaveBeenCalledTimes(1);
    expect(placeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: early.id }));
  });

  it("materializes a long-one target as SELL 1 early and BUY 1 late from a live long-one position", () => {
    const scheduler = new ScheduledOrderScheduler(
      new MemoryAppStateStore(),
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );
    const early = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 7,
      type: "repeating",
      runTime: "03:30",
    });
    scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 7,
      type: "repeating",
      runTime: "05:30",
    });

    scheduler.update(early.id, {
      direction: "BUY",
      size: 7,
      type: "repeating",
      runTime: "03:30",
      targetPosition: { enabled: true, direction: "BUY", size: 1 },
      targetCurrentPosition: 1,
    });

    expect(scheduler.list()).toEqual([
      expect.objectContaining({ direction: "SELL", size: 1, runTime: "03:30", status: "scheduled" }),
      expect.objectContaining({ direction: "BUY", size: 1, runTime: "05:30", status: "scheduled" }),
    ]);
  });

  it.each([
    [1, "SELL", 1, "SELL", 2, "paused"],
    [-2, "SELL", 1, "BUY", 1, "paused"],
    [-0.5, "SELL", 1, "SELL", 0.5, "paused"],
    [0, "SELL", 1, "SELL", 1, "paused"],
    [2, "BUY", 1, "SELL", 2, "scheduled"],
    [-2, "BUY", 1, "BUY", 2, "scheduled"],
  ] as const)(
    "materializes live position %s toward %s %s as early %s %s with late leg %s",
    (currentPosition, targetDirection, targetSize, earlyDirection, earlySize, lateStatus) => {
      const scheduler = new ScheduledOrderScheduler(
        new MemoryAppStateStore(),
        async () => ({ position: null, resolvedProtection: null }),
        new FakeClock(),
      );
      const early = scheduler.schedule({
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 7,
        type: "repeating",
        runTime: "03:30",
      });
      scheduler.schedule({
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 7,
        type: "repeating",
        runTime: "05:30",
      });

      scheduler.update(early.id, {
        direction: "BUY",
        size: 7,
        type: "repeating",
        runTime: "03:30",
        targetPosition: { enabled: true, direction: targetDirection, size: targetSize },
        targetCurrentPosition: currentPosition,
      });

      const [storedEarly, storedLate] = scheduler.list();
      expect(storedEarly).toMatchObject({
        direction: earlyDirection,
        size: earlySize,
        runTime: "03:30",
        status: "scheduled",
        targetPosition: { leg: "early", direction: targetDirection, size: targetSize },
      });
      expect(storedLate).toMatchObject({
        runTime: "05:30",
        status: lateStatus,
        targetPosition: { leg: "late", direction: targetDirection, size: targetSize },
      });
      if (targetDirection === "BUY") {
        expect(storedLate).toMatchObject({ direction: "BUY", size: targetSize });
      }
    },
  );

  it.each([2, -2, 0])("previews Saturday short 1.33 from projected zero after flattening %s", (exposure) => {
    const scheduler = new ScheduledOrderScheduler(
      new MemoryAppStateStore(),
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(new Date(2026, 8, 4, 12).getTime()),
    );
    const early = scheduler.schedule({
      epic: "XAUUSD", instrumentName: "Spot Gold", direction: "BUY", size: 7,
      type: "repeating", runTime: "03:30",
    });
    const late = scheduler.schedule({
      epic: "XAUUSD", instrumentName: "Spot Gold", direction: "BUY", size: 7,
      type: "repeating", runTime: "05:30",
    });
    scheduler.update(early.id, {
      direction: "BUY", size: 7, type: "repeating", runTime: "03:30",
      targetPosition: { enabled: true, direction: "SELL", size: 1.33 },
      targetCurrentPosition: exposure,
    });
    expect(scheduler.list().find((job) => job.id === late.id)).toMatchObject({
      direction: "SELL", size: 1.33, status: "scheduled", reason: undefined,
      targetPosition: { leg: "late", direction: "SELL", size: 1.33 },
    });
  });

  it("keeps 03:30 as the early leg when saved between the two repeating times", () => {
    const clock = new FakeClock(new Date(2026, 2, 23, 4, 0).getTime());
    const scheduler = new ScheduledOrderScheduler(
      new MemoryAppStateStore(),
      async () => ({ position: null, resolvedProtection: null }),
      clock,
    );
    const early = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 7,
      type: "repeating",
      runTime: "03:30",
    });
    scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 7,
      type: "repeating",
      runTime: "05:30",
    });

    scheduler.update(early.id, {
      direction: "BUY",
      size: 7,
      type: "repeating",
      runTime: "03:30",
      targetPosition: { enabled: true, direction: "SELL", size: 1 },
      targetCurrentPosition: 1,
    });

    const storedEarly = scheduler.list().find((job) => job.runTime === "03:30")!;
    const storedLate = scheduler.list().find((job) => job.runTime === "05:30")!;
    expect(storedEarly).toMatchObject({ status: "paused", targetAutoPaused: true, targetPosition: { leg: "early" } });
    expect(storedLate).toMatchObject({ direction: "SELL", size: 2, status: "scheduled", targetPosition: { leg: "late" } });
    expect(storedLate.runAt).toBe(new Date(2026, 2, 23, 5, 30).toISOString());
    expect(storedEarly.runAt).toBe(new Date(2026, 2, 24, 3, 30).toISOString());
  });

  it("edits a paused fixed order without arming it", async () => {
    const store = new MemoryAppStateStore();
    const placeSpy = vi.fn(async () => ({ position: null, resolvedProtection: null }));
    const clock = new FakeClock();
    const scheduler = new ScheduledOrderScheduler(store, placeSpy, clock);
    const job = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });
    scheduler.pause(job.id);

    const updated = scheduler.update(job.id, {
      direction: "SELL",
      size: 2,
      type: "one-off",
      runAt: "2026-03-23T11:30:00.000Z",
      protection: null,
      targetPosition: { enabled: false },
    });

    expect(updated).toMatchObject({ status: "paused", direction: "SELL", size: 2 });
    await clock.advanceTo("2026-03-23T12:00:00.000Z");
    expect(placeSpy).not.toHaveBeenCalled();
  });

  it("disables both pair legs while retaining their most recent concrete orders", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );
    const early = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });
    scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "SELL",
      size: 4,
      type: "one-off",
      runAt: "2026-03-23T11:30:00.000Z",
    });
    scheduler.update(early.id, {
      direction: "BUY",
      size: 3,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
      targetPosition: { enabled: true, direction: "BUY", size: 3 },
      targetCurrentPosition: 1,
    });

    scheduler.update(early.id, {
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
      protection: null,
      targetPosition: { enabled: false },
    });

    expect(scheduler.list().map((job) => job.targetPosition)).toEqual([null, null]);
    expect(scheduler.list().map(({ direction, size }) => ({ direction, size }))).toEqual([
      { direction: "BUY", size: 1 },
      { direction: "BUY", size: 3 },
    ]);
  });

  it("preserves active pair metadata when editing a leg's stored fixed order", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );
    const early = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "03:30",
    });
    scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "SELL",
      size: 4,
      type: "repeating",
      runTime: "05:30",
    });
    scheduler.update(early.id, {
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "03:30",
      targetPosition: { enabled: true, direction: "SELL", size: 3 },
      targetCurrentPosition: 0,
    });

    scheduler.update(early.id, {
      direction: "SELL",
      size: 2,
      type: "repeating",
      runTime: "03:45",
      protection: null,
    });

    const [storedEarly, storedLate] = scheduler.list();
    expect(storedEarly).toMatchObject({
      direction: "SELL",
      size: 2,
      runTime: "03:45",
      targetPosition: { leg: "early", direction: "SELL", size: 3 },
    });
    expect(storedLate).toMatchObject({
      direction: "SELL",
      size: 4,
      status: "paused",
      targetAutoPaused: true,
      targetPosition: { leg: "late", direction: "SELL", size: 3 },
    });
    expect(storedEarly.targetPosition?.pairId).toBe(storedLate.targetPosition?.pairId);

    scheduler.update(early.id, {
      direction: "SELL",
      size: 2,
      type: "repeating",
      runTime: "03:45",
      targetPosition: { enabled: true, direction: "BUY", size: 3 },
      targetCurrentPosition: 1,
    });
    expect(scheduler.list()[1]).toMatchObject({
      status: "scheduled",
      targetPosition: { leg: "late", direction: "BUY", size: 3 },
    });
    expect(scheduler.list()[1].reason).toBeUndefined();
  });

  it("rejects an invalid target pair and blocks cancelling an active pair leg", () => {
    const store = new MemoryAppStateStore();
    const scheduler = new ScheduledOrderScheduler(
      store,
      async () => ({ position: null, resolvedProtection: null }),
      new FakeClock(),
    );
    const early = scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
    });
    scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "SELL",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T11:30:00.000Z",
    });
    scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "SELL",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T12:30:00.000Z",
    });

    expect(() =>
      scheduler.update(early.id, {
        direction: "SELL",
        size: 2,
        type: "one-off",
        runAt: "2026-03-23T10:30:00.000Z",
        targetPosition: { enabled: true, direction: "SELL", size: 2 },
        targetCurrentPosition: 0,
      }),
    ).toThrow(/exactly two/i);

    scheduler.cancel(scheduler.list()[2].id);
    scheduler.update(early.id, {
      direction: "SELL",
      size: 2,
      type: "one-off",
      runAt: "2026-03-23T10:30:00.000Z",
      targetPosition: { enabled: true, direction: "SELL", size: 2 },
      targetCurrentPosition: 0,
    });
    expect(() => scheduler.cancel(early.id)).toThrow(/Disable target-position mode/i);
  });
});
