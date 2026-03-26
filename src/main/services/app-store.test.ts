import { describe, expect, it } from "vitest";
import { buildExecutionResult, MemoryAppStateStore } from "./app-store";

describe("buildExecutionResult", () => {
  it("redacts API keys from persisted execution log details", () => {
    const result = buildExecutionResult(
      "auth",
      "error",
      "Capital.com rejected CAP-SECRETKEY1234",
      'Payload: {"apiKey":"CAP-SECRETKEY1234"}',
    );

    expect(result.message).not.toContain("SECRETKEY1234");
    expect(result.detail).toContain("****");
  });
});

describe("MemoryAppStateStore", () => {
  it("filters out legacy close-schedule entries that do not match the current order schedule shape", () => {
    const store = new MemoryAppStateStore();
    store.patchState({
      schedules: [
        {
          id: "legacy-close-job",
          dealId: "deal-1",
          epic: "XAUUSD",
          instrumentName: "Spot Gold",
          scheduleType: "one-off",
          closeAt: "2026-03-24T06:00:00.000Z",
          status: "scheduled",
          createdAt: "2026-03-24T05:00:00.000Z",
        } as never,
      ],
    });

    expect(store.getState().schedules).toEqual([]);
  });
});
