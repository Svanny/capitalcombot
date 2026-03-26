// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { EMPTY_PROTECTION_FORM, validateProtectionForm } from "./protection-form";
import { parseLocalDateTime, parseLocalTime, validateOrderForm } from "./validation";

describe("validateOrderForm", () => {
  it("rejects invalid size", () => {
    const result = validateOrderForm({
      size: "0",
      runAt: "",
      runTime: "",
      scheduleType: "one-off",
      wantsScheduledClose: false,
      selectedMarketEpic: "XAUUSD",
    });

    expect(result.fieldErrors.size).toContain("greater than 0");
  });

  it("rejects past close times", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T10:00:00.000Z"));

    const result = validateOrderForm({
      size: "1",
      runAt: "2026-03-23T09:00",
      runTime: "",
      scheduleType: "one-off",
      wantsScheduledClose: true,
      selectedMarketEpic: "XAUUSD",
    });

    expect(result.fieldErrors.scheduleAt).toContain("future");
    vi.useRealTimers();
  });

  it("accepts repeating schedules with time only", () => {
    const result = validateOrderForm({
      size: "1",
      runAt: "",
      runTime: "18:45",
      scheduleType: "repeating",
      wantsScheduledClose: true,
      selectedMarketEpic: "XAUUSD",
    });

    expect(result.fieldErrors.scheduleAt).toBeUndefined();
    expect(result.schedule).toEqual({
      type: "repeating",
      runTime: "18:45",
    });
  });

  it("requires a selected market", () => {
    const result = validateOrderForm({
      size: "1",
      runAt: "",
      runTime: "",
      scheduleType: "one-off",
      wantsScheduledClose: false,
      selectedMarketEpic: null,
    });

    expect(result.fieldErrors.selectedMarketEpic).toContain("Select a market");
  });

  it("parses local datetime strings", () => {
    const parsed = parseLocalDateTime("2026-03-23T18:45");

    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(2);
    expect(parsed?.getDate()).toBe(23);
  });

  it("parses local time strings", () => {
    expect(parseLocalTime("18:45")).toEqual({
      hours: 18,
      minutes: 45,
    });
  });
});

describe("validateProtectionForm", () => {
  it("rejects a BUY stop-loss price above the market", () => {
    const result = validateProtectionForm(
      {
        ...EMPTY_PROTECTION_FORM,
        stopLossMode: "price_level",
        stopLossLevel: "3020",
      },
      "BUY",
      3010,
    );

    expect(result.fieldErrors.stopLossLevel).toContain("below the market price");
  });

  it("rejects risk/reward take profit without a stop loss", () => {
    const result = validateProtectionForm(
      {
        ...EMPTY_PROTECTION_FORM,
        takeProfitMode: "risk_reward",
        takeProfitRiskRewardRatio: "2",
      },
      "BUY",
      3010,
    );

    expect(result.fieldErrors.takeProfitRiskRewardRatio).toContain("needs a stop loss");
  });

  it("rejects invalid ADX multipliers", () => {
    const result = validateProtectionForm(
      {
        ...EMPTY_PROTECTION_FORM,
        stopLossMode: "adx_distance",
        stopLossAdxMultiplier: "0",
      },
      "SELL",
      3010,
    );

    expect(result.fieldErrors.stopLossAdxMultiplier).toContain("ADX multiplier");
  });

  it("accepts a valid distance stop loss with risk/reward take profit", () => {
    const result = validateProtectionForm(
      {
        ...EMPTY_PROTECTION_FORM,
        stopLossMode: "distance",
        stopLossDistance: "10",
        takeProfitMode: "risk_reward",
        takeProfitRiskRewardRatio: "2",
      },
      "BUY",
      3010,
    );

    expect(result.fieldErrors).toEqual({});
    expect(result.strategy).toEqual({
      stopLoss: { mode: "distance", distance: 10 },
      takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
    });
  });
});
