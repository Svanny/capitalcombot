import { describe, expect, it, vi } from "vitest";
import {
  buildExecutionResult,
  createAppStateStore,
  ElectronAppStateStore,
  MemoryAppStateStore,
} from "./app-store";
import * as stateIntegrity from "../security/state-integrity";

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

  it("filters out schedules with invalid nested protection data", () => {
    const store = new MemoryAppStateStore();
    store.patchState({
      schedules: [
        {
          id: "bad-protection",
          epic: "XAUUSD",
          instrumentName: "Spot Gold",
          direction: "BUY",
          size: 1,
          scheduleType: "one-off",
          runAt: "2026-03-24T06:00:00.000Z",
          status: "scheduled",
          createdAt: "2026-03-24T05:00:00.000Z",
          protection: {
            stopLoss: { mode: "distance", distance: -1 },
            takeProfit: { mode: "none" },
          },
        } as never,
      ],
    });

    expect(store.getState().schedules).toEqual([]);
  });
});

describe("createAppStateStore", () => {
  it("falls back to memory storage when secure persistence is unavailable", async () => {
    const fallback = new MemoryAppStateStore();
    const protectorSpy = vi
      .spyOn(stateIntegrity, "createStateIntegrityProtector")
      .mockResolvedValue({
        backend: "memory",
        protector: {
          sign: vi.fn(() => "signature"),
          verify: vi.fn(() => false),
        },
        warning: "Secure persisted app state is unavailable.",
      });

    const result = await createAppStateStore({ fallback });

    expect(result.backend).toBe("memory");
    expect(result.store).toBe(fallback);
    expect(result.warning).toContain("Secure persisted app state is unavailable");

    protectorSpy.mockRestore();
  });
});

describe("ElectronAppStateStore", () => {
  it("migrates legacy top-level state before writing the signed envelope", () => {
    const backingStore: Record<string, unknown> = {
      environment: "live",
      selectedMarket: {
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        symbol: "XAUUSD",
        instrumentType: "COMMODITIES",
        marketStatus: "TRADEABLE",
        bid: 3010.1,
        ask: 3010.8,
        percentageChange: 0.4,
        updateTime: "2026-03-23T10:00:00.000Z",
      },
      schedules: [
        {
          id: "schedule_XAUUSD",
          epic: "XAUUSD",
          instrumentName: "Spot Gold",
          direction: "BUY",
          size: 1,
          scheduleType: "one-off",
          runAt: "2026-03-24T06:00:00.000Z",
          status: "scheduled",
          createdAt: "2026-03-24T05:00:00.000Z",
        },
      ],
      executionLog: [
        {
          action: "market",
          status: "success",
          message: "Selected Spot Gold.",
          at: "2026-03-23T10:00:00.000Z",
        },
      ],
      savedProfile: {
        identifier: " trader@example.com ",
        environment: "live",
      },
    };
    const store = new ElectronAppStateStore(
      {
        sign: vi.fn(() => "signed-state"),
        verify: vi.fn(() => false),
      },
      {
        get store() {
          return backingStore;
        },
        set(key: string, value: unknown) {
          backingStore[key] = value;
        },
      },
    );

    const migrated = store.getState();

    expect(migrated.environment).toBe("live");
    expect(migrated.selectedMarket?.epic).toBe("XAUUSD");
    expect(migrated.savedProfile).toEqual({
      identifier: "trader@example.com",
      environment: "live",
    });
    expect(migrated.schedules).toEqual([]);
    expect(migrated.executionLog).toEqual([]);
    expect(backingStore.version).toBe(1);
    expect(backingStore.signature).toBe("signed-state");
    expect(backingStore.state).toMatchObject({
      environment: "live",
      savedProfile: {
        identifier: "trader@example.com",
        environment: "live",
      },
    });
  });
});
