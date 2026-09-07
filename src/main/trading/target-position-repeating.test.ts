import { afterEach, expect, it, vi } from "vitest";
import type { OpenPosition } from "../../shared/types";
import { MemoryAppStateStore } from "../state/app-store";
import { ScheduledOrderScheduler } from "./scheduler";
import { executeTargetPositionJob } from "./target-position-execution";

afterEach(() => vi.useRealTimers());

it("recovers a short target on Monday late after weekend failures and keeps running daily", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 4, 12));
  let exposure = 1.57;
  const closesAt = new Date(2026, 8, 5, 4).getTime();
  const opensAt = new Date(2026, 8, 7, 5).getTime();
  const client = {
    getAccountPreferences: vi.fn(async () => ({ hedgingMode: false })),
    listPositions: vi.fn(async (): Promise<OpenPosition[]> => exposure === 0 ? [] : [{
      dealId: "deal", dealReference: "ref", epic: "GOLD", instrumentName: "Gold",
      direction: exposure > 0 ? "BUY" : "SELL", size: Math.abs(exposure),
      level: 1, currency: "USD", pnl: 0, bid: 1, ask: 1,
      createdAt: new Date().toISOString(), stopLevel: null, profitLevel: null,
    }]),
    openMarketPosition: vi.fn(async (input: { direction: "BUY" | "SELL"; size: number }) => {
      // Simulated market availability, not a broker trading-hours assumption.
      if (Date.now() >= closesAt && Date.now() < opensAt) {
        throw { code: "CAPITAL_400", message: "Capital.com request failed.",
          detail: "error.market.closed", recoverable: false };
      }
      exposure = Number((exposure + (input.direction === "BUY" ? input.size : -input.size)).toFixed(10));
      return null;
    }),
  };
  const store = new MemoryAppStateStore();
  const execute = vi.fn((job: Parameters<typeof executeTargetPositionJob>[1]) =>
    executeTargetPositionJob(client, job));
  let scheduler = new ScheduledOrderScheduler(store, execute);
  const early = scheduler.schedule({
    epic: "GOLD", instrumentName: "Gold", direction: "BUY", size: 1.57,
    type: "repeating", runTime: "03:30",
  });
  const late = scheduler.schedule({
    epic: "GOLD", instrumentName: "Gold", direction: "SELL", size: 1.33,
    type: "repeating", runTime: "05:30",
  });
  scheduler.update(early.id, {
    direction: "BUY", size: 1.57, type: "repeating", runTime: "03:30",
    targetPosition: { enabled: true, direction: "SELL", size: 1.33 },
    targetCurrentPosition: exposure,
  });
  const advanceTo = async (date: Date) => vi.advanceTimersByTimeAsync(date.getTime() - Date.now());
  const lateJob = () => scheduler.list().find(job => job.id === late.id)!;

  await advanceTo(new Date(2026, 8, 5, 3, 30));
  expect(exposure).toBe(0);
  await advanceTo(new Date(2026, 8, 7, 3, 30));
  expect(exposure).toBe(0);
  expect(lateJob()).toMatchObject({ status: "scheduled", lastError: expect.stringContaining("error.market.closed") });

  await advanceTo(new Date(2026, 8, 7, 5, 30));
  expect(exposure).toBe(-1.33);
  expect(lateJob()).toMatchObject({ status: "scheduled", lastError: undefined });
  expect(lateJob().runAt).toBe(new Date(2026, 8, 8, 5, 30).toISOString());

  // Reload the scheduler from persisted schedules after the successful entry.
  vi.clearAllTimers();
  scheduler = new ScheduledOrderScheduler(store, execute);
  scheduler.restore();

  const submissions = client.openMarketPosition.mock.calls.length;
  await advanceTo(new Date(2026, 8, 8, 5, 30));
  expect(exposure).toBe(-1.33);
  expect(client.openMarketPosition).toHaveBeenCalledTimes(submissions);
  expect(lateJob().runAt).toBe(new Date(2026, 8, 9, 5, 30).toISOString());
  expect(execute.mock.calls.filter(([job]) => job.id === late.id)).toHaveLength(4);

  // A position change after the next early run is corrected by the late run.
  await advanceTo(new Date(2026, 8, 9, 4));
  exposure = -0.5;
  await advanceTo(new Date(2026, 8, 9, 5, 30));
  expect(exposure).toBe(-1.33);
  expect(client.openMarketPosition).toHaveBeenLastCalledWith({
    epic: "GOLD", direction: "SELL", size: 0.83, protection: null,
  });
  expect(lateJob().status).toBe("scheduled");
});
