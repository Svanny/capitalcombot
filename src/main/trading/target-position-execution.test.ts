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
    const mock = client({ listPositions: vi.fn(async () => []) });
    const lateShort = {
      ...job(),
      targetPosition: { ...job().targetPosition!, leg: "late" as const },
    };
    const result = await executeTargetPositionJob(mock, lateShort, new Date(2026, 8, 2, 5, 30));

    expect(result.reason).toMatch(/not needed/);
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
