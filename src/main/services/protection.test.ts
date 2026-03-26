import { describe, expect, it } from "vitest";
import { resolveProtection, type HistoricalPriceBar, type ProtectionContextClient } from "./protection";

function createClient(overrides: Partial<ProtectionContextClient> = {}): ProtectionContextClient {
  return {
    getQuote: async () => ({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      bid: 3010,
      ask: 3011,
      marketStatus: "TRADEABLE",
      percentageChange: 0.4,
      updateTime: "2026-03-23T10:00:00.000Z",
    }),
    getHistoricalPrices: async () =>
      Array.from({ length: 40 }, (_, index) => buildBar(index)),
    ...overrides,
  };
}

function buildBar(index: number): HistoricalPriceBar {
  const base = 3000 + index;

  return {
    high: base + 8,
    low: base - 8,
    close: base + 2,
    at: new Date(Date.parse("2026-03-23T10:00:00.000Z") + index * 900_000).toISOString(),
  };
}

describe("resolveProtection", () => {
  it("derives stop loss and take profit from distance and risk/reward", async () => {
    const resolved = await resolveProtection(createClient(), {
      epic: "XAUUSD",
      direction: "BUY",
      protection: {
        stopLoss: { mode: "distance", distance: 10 },
        takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
      },
    });

    expect(resolved).toEqual(
      expect.objectContaining({
        referencePrice: 3011,
        stopLevel: 3001,
        profitLevel: 3031,
        stopDistance: 10,
        profitDistance: 20,
      }),
    );
  });

  it("uses ADX-derived distance when requested", async () => {
    const resolved = await resolveProtection(createClient(), {
      epic: "XAUUSD",
      direction: "SELL",
      protection: {
        stopLoss: { mode: "adx_distance", adxMultiplier: 1.5 },
        takeProfit: { mode: "adx_distance", adxMultiplier: 2 },
      },
    });

    expect(resolved?.adxValue).toBeTypeOf("number");
    expect(resolved?.stopDistance).toBeGreaterThan(0);
    expect(resolved?.profitDistance).toBeGreaterThan(0);
    expect(resolved?.stopLevel).toBeGreaterThan(resolved?.referencePrice ?? 0);
    expect(resolved?.profitLevel).toBeLessThan(resolved?.referencePrice ?? 0);
  });

  it("throws when ADX mode lacks enough price history", async () => {
    await expect(
      resolveProtection(
        createClient({
          getHistoricalPrices: async () => Array.from({ length: 5 }, (_, index) => buildBar(index)),
        }),
        {
          epic: "XAUUSD",
          direction: "BUY",
          protection: {
            stopLoss: { mode: "adx_distance", adxMultiplier: 1.2 },
            takeProfit: { mode: "none" },
          },
        },
      ),
    ).rejects.toThrow("ADX-based protection");
  });
});
