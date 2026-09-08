import { afterEach, expect, it, vi } from "vitest";
import { CapitalClient } from "./client";
import { createIpcHandlers } from "../../ipc";
import { MemoryCredentialStore } from "../../security/credential-store";
import { MemoryAppStateStore } from "../../state/app-store";
import { ScheduledOrderScheduler } from "../scheduler";
import { executeTargetPositionJob } from "../target-position-execution";

afterEach(() => vi.useRealTimers());

const valid = { position: { dealId: "deal", direction: "SELL", size: 1.33 }, market: { epic: "GOLD" } };

async function broker(snapshot: unknown) {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/session")) return new Response("{}", {
      headers: { CST: "test", "X-SECURITY-TOKEN": "test" },
    });
    if (path.endsWith("/accounts/preferences")) return new Response(JSON.stringify({ hedgingMode: false }));
    if (path.endsWith("/positions") && !init?.method) return new Response(JSON.stringify(snapshot));
    throw new Error("Unexpected broker call");
  });
  const client = new CapitalClient(fetchMock);
  await client.connect({ identifier: "test", password: "test", apiKey: "test", environment: "demo" });
  return { client, fetchMock };
}

it.each([
  undefined, null, [], {}, { positions: null }, { positions: {} },
  { positions: [null] }, { positions: [{}] },
  { positions: [{ ...valid, market: {} }] },
  { positions: [{ ...valid, market: { epic: " " } }] },
  { positions: [{ ...valid, position: { size: 1 } }] },
  { positions: [{ ...valid, position: { direction: "LONG", size: 1 } }] },
  ...[null, "", " ", true, [], {}, -1, 0, "NaN", "Infinity", "-1"].map((size) => ({
    positions: [valid, { ...valid, position: { direction: "BUY", size } }],
  })),
])("rejects the entire malformed positions snapshot %#", async (snapshot) => {
  // Undefined is represented by a missing positions field in a JSON response.
  const { client } = await broker(snapshot === undefined ? {} : snapshot);
  await expect(client.listPositions()).rejects.toMatchObject({ code: "POSITIONS_RESPONSE_INVALID" });
});

it("accepts an explicit empty portfolio and normalizes numeric position sizes", async () => {
  const empty = await broker({ positions: [] });
  await expect(empty.client.listPositions()).resolves.toEqual([]);
  const { client } = await broker({ positions: [valid,
    { position: { direction: "BUY", size: " 2.5 " }, market: { epic: "SILVER" } }] });
  await expect(client.listPositions()).resolves.toMatchObject([
    { epic: "GOLD", direction: "SELL", size: 1.33 }, { epic: "SILVER", direction: "BUY", size: 2.5 },
  ]);
});

it("rejects malformed snapshots through target saving and execution without changing the target or placing orders", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 8, 2));
  const { client, fetchMock } = await broker({});
  const store = new MemoryAppStateStore();
  const scheduler = new ScheduledOrderScheduler(store, (job) => executeTargetPositionJob(client, job));
  const early = scheduler.schedule({ epic: "GOLD", instrumentName: "Gold", direction: "BUY", size: 2,
    type: "repeating", runTime: "03:30" });
  scheduler.schedule({ epic: "GOLD", instrumentName: "Gold", direction: "SELL", size: 1.33,
    type: "repeating", runTime: "05:30" });
  scheduler.update(early.id, { direction: "BUY", size: 2, type: "repeating", runTime: "03:30",
    targetPosition: { enabled: true, direction: "SELL", size: 1.33 }, targetCurrentPosition: 2 });
  const before = scheduler.list();
  const handlers = createIpcHandlers({ client, store, scheduler, credentials: new MemoryCredentialStore() });
  await expect(handlers.updateSchedule({ jobId: early.id, direction: "BUY", size: 2,
    schedule: { type: "repeating", runTime: "03:30" },
    targetPosition: { enabled: true, direction: "BUY", size: 4 },
  })).rejects.toThrow(/POSITIONS_RESPONSE_INVALID/);
  expect(scheduler.list()).toEqual(before);
  await vi.advanceTimersByTimeAsync(new Date(2026, 8, 8, 5, 30).getTime() - Date.now());
  expect(scheduler.list().every((job) => job.status === "scheduled" && job.lastError?.includes("invalid positions snapshot"))).toBe(true);
  expect(store.getState().executionLog.filter((entry) => entry.status === "error")).toHaveLength(2);
  const writes = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/positions") && init?.method === "POST");
  expect(writes).toHaveLength(0);
});
