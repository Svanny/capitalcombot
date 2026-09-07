import { describe, expect, it, vi } from "vitest";
import type { OpenPosition, ScheduledOrderJob } from "../../shared/types";
import { executeTargetPositionJob, type TargetPositionExecutionClient } from "./target-position-execution";

function job(): ScheduledOrderJob {
  return {
    id: "early",
    epic: "XAUUSD",
    instrumentName: "Spot Gold",
    direction: "BUY",
    size: 99,
    scheduleType: "repeating",
    runAt: "2026-09-02T03:30:00.000Z",
    runTime: "03:30",
    status: "scheduled",
    createdAt: "2026-09-01T00:00:00.000Z",
    protection: { stopLoss: { mode: "distance", distance: 10 }, takeProfit: { mode: "none" } },
    targetPosition: {
      pairId: "pair-1",
      leg: "early",
      direction: "SELL",
      size: 3,
    },
  };
}

function openPosition(): OpenPosition {
  return {
    dealId: "deal-1",
    dealReference: "p-deal-1",
    epic: "XAUUSD",
    instrumentName: "Spot Gold",
    direction: "BUY",
    size: 2,
    level: 1,
    currency: "USD",
    pnl: 0,
    bid: 1,
    ask: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    stopLevel: null,
    profitLevel: null,
  };
}

function client(overrides: Partial<TargetPositionExecutionClient> = {}): TargetPositionExecutionClient {
  return {
    getAccountPreferences: vi.fn(async () => ({ hedgingMode: false })),
    listPositions: vi.fn(async () => [openPosition()]),
    openMarketPosition: vi.fn(async () => null),
    ...overrides,
  };
}

describe("executeTargetPositionJob", () => {
  it.each([0, -0.5, 2])("targets short 1.33 on Saturday late using live exposure %s", async (exposure) => {
    const mock = client({
      listPositions: vi.fn(async (): Promise<OpenPosition[]> => exposure === 0 ? [] : [{
        ...openPosition(), direction: exposure > 0 ? "BUY" : "SELL", size: Math.abs(exposure),
      }]),
    });
    await executeTargetPositionJob(mock, {
      ...job(), targetPosition: { ...job().targetPosition!, leg: "late", size: 1.33 },
    }, new Date(2026, 8, 5, 5, 30));
    expect(mock.openMarketPosition).toHaveBeenCalledWith({
      epic: "XAUUSD", direction: "SELL", size: Number((1.33 + exposure).toFixed(10)), protection: null,
    });
  });

  it.each([
    [2, "BUY", 1], [-2, "BUY", 1], [0, "BUY", 1],
    [2, "SELL", 1], [-2, "SELL", 1], [-0.5, "SELL", 1], [0, "SELL", 1], [-1, "SELL", 1],
  ] as const)("reaches target %s -> %s %s from live exposure after both legs", async (initial, direction, size) => {
    let exposure = initial as number;
    const mock = client({
      listPositions: vi.fn(async (): Promise<OpenPosition[]> => exposure === 0 ? [] : [{
        ...openPosition(), direction: exposure > 0 ? "BUY" : "SELL", size: Math.abs(exposure),
      }]),
      openMarketPosition: vi.fn(async (input) => {
        exposure += input.direction === "BUY" ? input.size : -input.size;
        return null;
      }),
    });
    const early = { ...job(), targetPosition: { ...job().targetPosition!, direction, size } };
    await executeTargetPositionJob(mock, early, new Date(2026, 8, 4, 3, 30));
    if (direction === "BUY") expect(exposure).toBe(0);
    await executeTargetPositionJob(mock, {
      ...early, targetPosition: { ...early.targetPosition, leg: "late" },
    }, new Date(2026, 8, 4, 5, 30));
    expect(exposure).toBe(direction === "BUY" ? size : -size);
  });

  it("submits the Saturday late live adjustment and propagates broker rejection", async () => {
    const rejection = new Error("Market is closed");
    const mock = client({
      openMarketPosition: vi.fn(async () => { throw rejection; }),
    });
    const lateLong = {
      ...job(),
      targetPosition: { ...job().targetPosition!, direction: "BUY" as const, leg: "late" as const },
    };

    await expect(executeTargetPositionJob(mock, lateLong, new Date(2026, 8, 5, 5, 30)))
      .rejects.toBe(rejection);
    expect(mock.openMarketPosition).toHaveBeenCalledWith({
      epic: "XAUUSD", direction: "BUY", size: 1, protection: null,
    });
  });

  it("uses live exposure, ignores fixed payload protection, and submits the derived delta", async () => {
    const mock = client();
    const result = await executeTargetPositionJob(mock, job(), new Date(2026, 8, 2, 3, 30));

    expect(mock.openMarketPosition).toHaveBeenCalledWith({
      epic: "XAUUSD",
      direction: "SELL",
      size: 5,
      protection: null,
    });
    expect(result.reason).toMatch(/Submitted SELL 5/);
  });

  it("fails closed before reading positions when hedging mode is enabled", async () => {
    const mock = client({
      getAccountPreferences: vi.fn(async () => ({ hedgingMode: true })),
    });

    await expect(executeTargetPositionJob(mock, job())).rejects.toMatchObject({
      code: "HEDGING_MODE_ENABLED",
    });
    expect(mock.listPositions).not.toHaveBeenCalled();
    expect(mock.openMarketPosition).not.toHaveBeenCalled();
  });

  it("records no-op legs without submitting a zero-size order", async () => {
    const mock = client({
      listPositions: vi.fn(async () => [{ ...openPosition(), direction: "SELL" as const, size: 3 }]),
    });
    const lateShort = {
      ...job(),
      targetPosition: { ...job().targetPosition!, leg: "late" as const },
    };
    const result = await executeTargetPositionJob(mock, lateShort, new Date(2026, 8, 2, 5, 30));

    expect(result.reason).toMatch(/already satisfies/);
    expect(mock.openMarketPosition).not.toHaveBeenCalled();
  });

  it("re-fetches live exposure between the early flatten and late long entry", async () => {
    const listPositions = vi
      .fn()
      .mockResolvedValueOnce([openPosition()])
      .mockResolvedValueOnce([{ ...openPosition(), size: 0.25 }]);
    const mock = client({ listPositions });
    const longTarget = {
      ...job(),
      targetPosition: { ...job().targetPosition!, direction: "BUY" as const, size: 1 },
    };

    await executeTargetPositionJob(mock, longTarget, new Date(2026, 8, 2, 3, 30));
    await executeTargetPositionJob(
      mock,
      { ...longTarget, targetPosition: { ...longTarget.targetPosition, leg: "late" as const } },
      new Date(2026, 8, 2, 5, 30),
    );

    expect(listPositions).toHaveBeenCalledTimes(2);
    expect(mock.openMarketPosition).toHaveBeenNthCalledWith(1, {
      epic: "XAUUSD",
      direction: "SELL",
      size: 2,
      protection: null,
    });
    expect(mock.openMarketPosition).toHaveBeenNthCalledWith(2, {
      epic: "XAUUSD",
      direction: "BUY",
      size: 0.75,
      protection: null,
    });
  });
});
