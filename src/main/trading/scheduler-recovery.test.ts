import { afterEach, expect, it, vi } from "vitest";
import type { ScheduledOrderJob } from "../../shared/types";
import { MemoryAppStateStore } from "../state/app-store";
import { ScheduledOrderScheduler } from "./scheduler";
import { executeTargetPositionJob } from "./target-position-execution";

afterEach(() => vi.useRealTimers());

it.each(["pause", "cancel", "restore", "restore-unarmed"] as const)(
  "failed %s persistence retains the scheduled state and executes exactly once", async (action) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 2));
    const store = new MemoryAppStateStore();
    const place = vi.fn(async () => ({ position: null, resolvedProtection: null }));
    const scheduler = new ScheduledOrderScheduler(store, place);
    const job = scheduler.schedule({ epic: "GOLD", instrumentName: "Gold", direction: "SELL", size: 1,
      type: "one-off", runAt: new Date(Date.now() + 60_000).toISOString() });
    const before = store.getState();
    vi.spyOn(store, "setSchedules").mockImplementationOnce(() => { throw new Error("Disk full"); });
    expect(() => {
      if (action === "restore") scheduler.restore();
      else if (action === "restore-unarmed") scheduler.restore({ armScheduled: false });
      else scheduler[action](job.id);
    }).toThrow("Disk full");
    expect(store.getState()).toEqual(before);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(place).toHaveBeenCalledTimes(1);
    expect(store.getState().schedules[0].status).toBe("executed");
  },
);

function interrupted(type: "one-off" | "repeating"): ScheduledOrderJob {
  return { id: "interrupted", epic: "GOLD", instrumentName: "Gold", direction: "BUY", size: 99,
    scheduleType: type, runTime: type === "repeating" ? "03:30" : undefined,
    runAt: new Date(2026, 8, 8, 3, 30).toISOString(), status: "executing",
    createdAt: new Date(2026, 8, 7).toISOString(), lastAttemptAt: new Date(2026, 8, 8, 3, 30, 1).toISOString() };
}

it.each([2, 4])("restores interrupted daily execution at the next future occurrence from hour %s", async (hour) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 8, hour));
  const store = new MemoryAppStateStore();
  const saved = interrupted("repeating");
  store.setSchedules([saved]);
  const place = vi.fn(async () => ({ position: null, resolvedProtection: null }));
  const scheduler = new ScheduledOrderScheduler(store, place);
  scheduler.restore();
  const expected = new Date(2026, 8, hour < 3 ? 8 : 9, 3, 30);
  expect(scheduler.list()[0]).toMatchObject({ status: "scheduled", runAt: expected.toISOString(),
    lastAttemptAt: saved.lastAttemptAt, lastError: expect.stringContaining("outcome is unknown") });
  await vi.advanceTimersByTimeAsync(expected.getTime() - Date.now() - 1);
  expect(place).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(place).toHaveBeenCalledTimes(1);
});

it("marks an interrupted one-off for broker review without replaying it", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 8, 4));
  const store = new MemoryAppStateStore();
  const saved = interrupted("one-off");
  store.setSchedules([saved]);
  const place = vi.fn();
  const scheduler = new ScheduledOrderScheduler(store, place);
  scheduler.restore();
  scheduler.armScheduledJobs();
  expect(scheduler.list()[0]).toMatchObject({ status: "failed", lastAttemptAt: saved.lastAttemptAt,
    reason: expect.stringContaining("Check the broker account") });
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(place).not.toHaveBeenCalled();
});

it("an interrupted target uses fresh exposure at the next daily check", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 8, 4));
  const store = new MemoryAppStateStore();
  store.setSchedules([{ ...interrupted("repeating"),
    targetPosition: { pairId: "pair", leg: "early", direction: "SELL", size: 1.33 } }]);
  const client = {
    getAccountPreferences: vi.fn(async () => ({ hedgingMode: false })),
    listPositions: vi.fn(async () => []),
    openMarketPosition: vi.fn(async () => null),
  };
  const scheduler = new ScheduledOrderScheduler(store, (job) => executeTargetPositionJob(client, job));
  scheduler.restore();
  expect(client.listPositions).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(new Date(2026, 8, 9, 3, 30).getTime() - Date.now());
  expect(client.listPositions).toHaveBeenCalledTimes(1);
  expect(client.openMarketPosition).toHaveBeenCalledWith({ epic: "GOLD", direction: "SELL", size: 1.33, protection: null });
});
