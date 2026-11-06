import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { startConnectionMaintenance, startRuntimeHeartbeat } from "./health";

vi.mock("node:fs", () => ({ writeFileSync: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());

it("writes a fresh, credential-free heartbeat immediately and every ten seconds", async () => {
  const stop = startRuntimeHeartbeat("health.json", () => true);
  expect(writeFileSync).toHaveBeenCalledOnce();
  const payload = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
  expect(Object.keys(payload).sort()).toEqual(["at", "connected", "pid"]);
  expect(payload).toMatchObject({ pid: process.pid, connected: true });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(writeFileSync).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(writeFileSync).toHaveBeenCalledTimes(2);
});
it("does not create a heartbeat outside supervised mode", () => {
  startRuntimeHeartbeat(undefined, () => false)();
  expect(writeFileSync).not.toHaveBeenCalled();
});
it("does not report healthy if the command listener has stopped", () => {
  expect(() => startRuntimeHeartbeat("health.json", () => true, () => false)).toThrow("CLI listener stopped");
  expect(writeFileSync).not.toHaveBeenCalled();
});
it("retries broker connection after an outage and logs state transitions", async () => {
  const connect = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const log = vi.fn();
  const stop = startConnectionMaintenance(connect, log);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(connect).toHaveBeenCalledTimes(3);
  expect(log.mock.calls).toEqual([["broker-connection-unavailable", "offline"], ["broker-connection-ready"]]);
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(connect).toHaveBeenCalledTimes(3);
});
it("does not overlap slow broker checks", async () => {
  let resolve!: () => void;
  const connect = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  const stop = startConnectionMaintenance(connect, vi.fn());
  await vi.advanceTimersByTimeAsync(120_000);
  expect(connect).toHaveBeenCalledOnce();
  resolve();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(connect).toHaveBeenCalledTimes(2);
  stop(); resolve();
});
