import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenPosition, TradeDirection } from "../../shared/types";
import { MemoryAppStateStore } from "../state/app-store";
import { ScheduledOrderScheduler } from "./scheduler";
import { executeTargetPositionJob } from "./target-position-execution";

afterEach(() => vi.useRealTimers());

function setup(day = 8, initial = 2, oneOff = false) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, day, 2));
  let exposure = initial;
  const client = {
    getAccountPreferences: vi.fn(async () => ({ hedgingMode: false })),
    listPositions: vi.fn(async (): Promise<OpenPosition[]> => exposure === 0 ? [] : [{
      dealId: "deal", dealReference: "ref", epic: "GOLD", instrumentName: "Gold",
      direction: exposure > 0 ? "BUY" : "SELL", size: Math.abs(exposure), level: 1,
      currency: "USD", pnl: 0, bid: 1, ask: 1, createdAt: new Date().toISOString(),
      stopLevel: null, profitLevel: null,
    }]),
    openMarketPosition: vi.fn(async (input: { direction: TradeDirection; size: number }) => {
      exposure = Number((exposure + (input.direction === "BUY" ? input.size : -input.size)).toFixed(10));
      return null;
    }),
  };
  let store = new MemoryAppStateStore();
  let scheduler = new ScheduledOrderScheduler(store, (job) => executeTargetPositionJob(client, job));
  const early = scheduler.schedule({ epic: "GOLD", instrumentName: "Gold", direction: "SELL", size: 7,
    ...(oneOff ? { type: "one-off" as const, runAt: new Date(2026, 8, day, 3, 30).toISOString() }
      : { type: "repeating" as const, runTime: "03:30" }),
  });
  const late = scheduler.schedule({ epic: "GOLD", instrumentName: "Gold", direction: "BUY", size: 7,
    ...(oneOff ? { type: "one-off" as const, runAt: new Date(2026, 8, day, 5, 30).toISOString() }
      : { type: "repeating" as const, runTime: "05:30" }),
  });
  const get = (id: string) => scheduler.list().find((job) => job.id === id)!;
  return {
    client, early, late, get,
    get scheduler() { return scheduler; },
    get store() { return store; },
    get exposure() { return exposure; },
    set exposure(value: number) { exposure = value; },
    save(direction: TradeDirection, size = 1.33, id = early.id) {
      const job = get(id);
      scheduler.update(id, { direction: job.direction, size: job.size,
        ...(oneOff ? { type: "one-off" as const, runAt: job.runAt }
          : { type: "repeating" as const, runTime: job.runTime! }),
        targetPosition: { enabled: true, direction, size }, targetCurrentPosition: exposure,
      });
    },
    async advance(day: number, hour: number, minute = 30) {
      await vi.advanceTimersByTimeAsync(new Date(2026, 8, day, hour, minute).getTime() - Date.now());
    },
    reload() {
      const now = Date.now();
      const state = JSON.parse(JSON.stringify(store.getState()));
      vi.clearAllTimers();
      vi.setSystemTime(now);
      store = new MemoryAppStateStore();
      store.patchState(state);
      scheduler = new ScheduledOrderScheduler(store, (job) => executeTargetPositionJob(client, job));
      scheduler.restore();
    },
  };
}

describe("target lifecycle matrix", () => {
  for (const oneOff of [false, true]) {
    for (let day = 6; day <= 12; day++) {
      for (const initial of [-2, -1.33, -0.5, 0, 0.5, 1.33, 2]) {
        for (const direction of ["BUY", "SELL"] as const) {
          it(`${oneOff ? "one-off" : "daily"} day ${day}, live ${initial}, target ${direction} 1.33`, async () => {
            const context = setup(day, initial, oneOff);
            context.save(direction);
            const target = direction === "BUY" ? 1.33 : -1.33;
            const earlyExposure = new Date(2026, 8, day).getDay() === 6 || direction === "BUY" ? 0 : target;
            expect(context.get(context.early.id).status).toBe(initial === earlyExposure ? "paused" : "scheduled");
            expect(context.get(context.late.id).status).toBe(earlyExposure === target ? "paused" : "scheduled");
            context.reload();
            await context.advance(day, 3);
            expect(context.exposure).toBe(earlyExposure);
            await context.advance(day, 5);
            expect(context.exposure).toBe(target);
            const orders = context.client.openMarketPosition.mock.calls.map(([input]) => input);
            expect(orders).toHaveLength(Number(initial !== earlyExposure) + Number(earlyExposure !== target));
            expect(orders.every((order) => order.size > 0)).toBe(true);
            if (oneOff) expect(context.scheduler.list().every((job) => job.status === "executed")).toBe(true);
          });
        }
      }
    }
  }

  it("reactivates the unused long leg on a target switch and keeps manual pauses", () => {
    const context = setup();
    context.save("SELL");
    expect(context.get(context.late.id)).toMatchObject({ status: "paused", targetAutoPaused: true });
    context.save("BUY", 1.55, context.late.id);
    expect(context.get(context.late.id)).toMatchObject({ status: "scheduled", direction: "BUY", size: 1.55 });
    context.scheduler.pause(context.late.id);
    context.save("BUY", 2);
    context.reload();
    expect(context.get(context.late.id)).toMatchObject({ status: "paused", targetAutoPaused: undefined });
  });

  it("a manual Pause on an automatic pause disables its future checks", async () => {
    const context = setup();
    context.save("SELL");
    context.scheduler.pause(context.late.id);
    context.reload();
    await context.advance(8, 3);
    context.exposure = 0;
    const calls = context.client.listPositions.mock.calls.length;
    await context.advance(8, 5);
    expect(context.client.listPositions).toHaveBeenCalledTimes(calls);
    expect(context.exposure).toBe(0);
    context.scheduler.reactivate(context.late.id);
    expect(context.get(context.late.id).status).toBe("scheduled");
  });

  it("does not assume a manually paused early flatten took place", async () => {
    const context = setup();
    context.scheduler.pause(context.early.id);
    context.save("BUY", 1.33);
    expect(context.get(context.late.id)).toMatchObject({ direction: "SELL", size: 0.67, status: "scheduled" });
    await context.advance(8, 5);
    expect(context.exposure).toBe(1.33);
    expect(context.client.openMarketPosition).toHaveBeenCalledTimes(1);
  });

  it("the automatically paused late leg recovers a failed early order", async () => {
    const context = setup();
    context.save("SELL");
    context.client.openMarketPosition.mockRejectedValueOnce(new Error("Market closed"));
    await context.advance(8, 3);
    expect(context.exposure).toBe(2);
    expect(context.get(context.early.id).lastError).toContain("Market closed");
    await context.advance(8, 5);
    expect(context.exposure).toBe(-1.33);
    expect(context.client.openMarketPosition).toHaveBeenLastCalledWith({
      epic: "GOLD", direction: "SELL", size: 3.33, protection: null,
    });
  });

  it("keeps today's late entry when saving after the early time", async () => {
    const context = setup();
    await context.advance(8, 4, 0);
    context.exposure = 0;
    context.save("BUY");
    expect(context.get(context.late.id).runAt).toBe(new Date(2026, 8, 8, 5, 30).toISOString());
    await context.advance(8, 5);
    expect(context.exposure).toBe(1.33);
  });

  it("automatically paused short legs flatten and re-enter on Saturday", async () => {
    const context = setup(11, -1.33);
    context.save("SELL");
    expect(context.scheduler.list().every((job) => job.status === "paused")).toBe(true);
    await context.advance(11, 5);
    context.reload();
    await context.advance(12, 3);
    expect(context.exposure).toBe(0);
    await context.advance(12, 5);
    expect(context.exposure).toBe(-1.33);
    expect(context.client.openMarketPosition).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing timers if an atomic pair save fails", async () => {
    const context = setup();
    context.save("SELL");
    const before = context.scheduler.list();
    vi.spyOn(context.store, "setSchedules").mockImplementationOnce(() => { throw new Error("Disk full"); });
    expect(() => context.save("BUY")).toThrow("Disk full");
    expect(context.scheduler.list()).toEqual(before);
    await context.advance(8, 5);
    expect(context.exposure).toBe(-1.33);
  });

  it("disabling target mode clears automatic pauses but preserves manual pauses", () => {
    const context = setup();
    context.save("SELL");
    context.scheduler.pause(context.early.id);
    context.scheduler.update(context.late.id, {
      type: "repeating", runTime: "05:30", direction: "BUY", size: 2,
      targetPosition: { enabled: false },
    });
    context.reload();
    expect(context.get(context.late.id)).toMatchObject({ status: "scheduled", targetPosition: null, targetAutoPaused: undefined });
    expect(context.get(context.early.id)).toMatchObject({ status: "paused", targetPosition: null, targetAutoPaused: undefined });
  });
});
