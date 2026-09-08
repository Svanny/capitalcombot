import { afterEach, expect, it, vi } from "vitest";
import { MemoryAppStateStore } from "../state/app-store";
import { ScheduledOrderScheduler, type SchedulerClock } from "./scheduler";

afterEach(() => vi.useRealTimers());

it("chunks long timers instead of submitting a distant one-off immediately", async () => {
  vi.useFakeTimers();
  const now = new Date(2026, 8, 8, 2).getTime();
  vi.setSystemTime(now);
  const place = vi.fn(async () => ({ position: null, resolvedProtection: null }));
  const scheduler = new ScheduledOrderScheduler(new MemoryAppStateStore(), place);
  const wait = 40 * 24 * 60 * 60 * 1000;
  scheduler.schedule({ epic: "GOLD", instrumentName: "Gold", direction: "BUY", size: 1,
    type: "one-off", runAt: new Date(now + wait).toISOString() });
  await vi.advanceTimersByTimeAsync(wait - 1);
  expect(place).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(place).toHaveBeenCalledTimes(1);
});

it("restore without arming removes existing timers including handle zero", () => {
  const clearTimer = vi.fn();
  const clock: SchedulerClock = { now: () => 0, setTimer: () => 0, clearTimer };
  const scheduler = new ScheduledOrderScheduler(new MemoryAppStateStore(), vi.fn(), clock);
  scheduler.schedule({ epic: "GOLD", instrumentName: "Gold", direction: "BUY", size: 1,
    type: "one-off", runAt: new Date(60_000).toISOString() });
  scheduler.restore({ armScheduled: false });
  expect(clearTimer).toHaveBeenCalledWith(0);
});
