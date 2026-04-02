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
    ).toThrow(/pending scheduled orders/i);

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
});
