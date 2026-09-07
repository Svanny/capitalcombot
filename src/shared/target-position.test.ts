import { describe, expect, it } from "vitest";
import type { OpenPosition, ScheduledOrderJob } from "./types";
import {
  aggregateSignedPosition,
  getTargetPairEligibility,
  planTargetTransition,
} from "./target-position";

function position(direction: "BUY" | "SELL", size: number, epic = "XAUUSD"): OpenPosition {
  return {
    dealId: `${direction}-${size}`,
    dealReference: `p-${direction}-${size}`,
    epic,
    instrumentName: epic,
    direction,
    size,
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

function schedule(overrides: Partial<ScheduledOrderJob> = {}): ScheduledOrderJob {
  return {
    id: "early",
    epic: "XAUUSD",
    instrumentName: "Spot Gold",
    direction: "BUY",
    size: 1,
    scheduleType: "one-off",
    runAt: "2026-09-01T03:30:00.000Z",
    status: "scheduled",
    createdAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("target-position planning", () => {
  it("aggregates signed exposure for only the requested epic", () => {
    expect(
      aggregateSignedPosition(
        [position("BUY", 3), position("SELL", 1.25), position("BUY", 9, "SILVER")],
        "XAUUSD",
      ),
    ).toBe(1.75);
  });

  it.each([
    [2, "SELL", 3, "early", "SELL", 5],
    [-2, "SELL", 3, "early", "SELL", 1],
    [-5, "SELL", 3, "early", "BUY", 2],
    [0, "SELL", 3, "early", "SELL", 3],
    [-3, "SELL", 3, "early", null, null],
    [2, "BUY", 3, "early", "SELL", 2],
    [-2, "BUY", 3, "early", "BUY", 2],
    [0, "BUY", 3, "early", null, null],
    [0, "BUY", 3, "late", "BUY", 3],
    [-2, "BUY", 3, "late", "BUY", 5],
    [5, "BUY", 3, "late", "SELL", 2],
    [3, "BUY", 3, "late", null, null],
    [0, "SELL", 3, "late", "SELL", 3],
    [-1, "SELL", 3, "late", "SELL", 2],
    [-5, "SELL", 3, "late", "BUY", 2],
    [2, "SELL", 3, "late", "SELL", 5],
    [-3, "SELL", 3, "late", null, null],
  ] as const)(
    "plans current %s toward %s %s on the %s leg",
    (currentPosition, targetDirection, targetSize, leg, direction, size) => {
      const plan = planTargetTransition({
        currentPosition,
        targetDirection,
        targetSize,
        leg,
        executionTime: new Date(2026, 8, 2, 3, 30),
      });

      if (direction === null) {
        expect(plan.kind).toBe("noop");
      } else {
        expect(plan).toMatchObject({ kind: "order", direction, size });
      }
    },
  );

  it("recovers a short target on Monday late after earlier orders could not execute", () => {
    expect(
      planTargetTransition({
        currentPosition: 0,
        targetDirection: "SELL",
        targetSize: 2,
        leg: "late",
        executionTime: new Date(2026, 8, 7, 5, 30),
      }),
    ).toMatchObject({ kind: "order", direction: "SELL", size: 2 });
  });

  it("flattens at the Saturday-morning Friday close and otherwise adjusts normally on weekends", () => {
    expect(
      planTargetTransition({
        currentPosition: -2,
        targetDirection: "BUY",
        targetSize: 3,
        leg: "early",
        executionTime: new Date(2026, 8, 4, 3, 30),
      }),
    ).toMatchObject({ kind: "order", direction: "BUY", size: 2 });
    expect(
      planTargetTransition({
        currentPosition: 2,
        targetDirection: "BUY",
        targetSize: 3,
        leg: "late",
        executionTime: new Date(2026, 8, 4, 5, 30),
      }),
    ).toMatchObject({ kind: "order", direction: "BUY", size: 1 });
    expect(
      planTargetTransition({
        currentPosition: 2,
        targetDirection: "SELL",
        targetSize: 3,
        leg: "early",
        executionTime: new Date(2026, 8, 5, 3, 30),
      }),
    ).toMatchObject({ kind: "order", direction: "SELL", size: 2 });
    expect(
      planTargetTransition({
        currentPosition: 0,
        targetDirection: "BUY",
        targetSize: 3,
        leg: "late",
        executionTime: new Date(2026, 8, 5, 5, 30),
      }),
    ).toMatchObject({ kind: "order", direction: "BUY", size: 3 });
    expect(
      planTargetTransition({
        currentPosition: 2,
        targetDirection: "SELL",
        targetSize: 3,
        leg: "early",
        executionTime: new Date(2026, 8, 6, 3, 30),
      }),
    ).toMatchObject({ kind: "order", direction: "SELL", size: 5 });
  });
});

describe("target-position pair eligibility", () => {
  it("accepts exactly two same-market scheduled or paused jobs and sorts them", () => {
    const result = getTargetPairEligibility(
      [
        schedule({ id: "late", runAt: "2026-09-01T05:30:00.000Z", status: "paused" }),
        schedule(),
        schedule({ id: "silver", epic: "SILVER" }),
      ],
      "XAUUSD",
    );

    expect(result.eligible).toBe(true);
    expect(result.jobs.map((job) => job.id)).toEqual(["early", "late"]);
  });

  it("orders repeating pairs by configured clock time instead of the next absolute occurrence", () => {
    const result = getTargetPairEligibility(
      [
        schedule({
          id: "early",
          scheduleType: "repeating",
          runTime: "03:30",
          runAt: "2026-09-02T03:30:00.000Z",
        }),
        schedule({
          id: "late",
          scheduleType: "repeating",
          runTime: "05:30",
          runAt: "2026-09-01T05:30:00.000Z",
        }),
      ],
      "XAUUSD",
    );

    expect(result.eligible).toBe(true);
    expect(result.jobs.map((job) => job.id)).toEqual(["early", "late"]);
  });

  it("rejects wrong counts, mixed types, equal times, and cross-date one-offs", () => {
    expect(getTargetPairEligibility([schedule()], "XAUUSD").eligible).toBe(false);
    expect(
      getTargetPairEligibility(
        [schedule(), schedule({ id: "late", scheduleType: "repeating", runTime: "05:30" })],
        "XAUUSD",
      ).eligible,
    ).toBe(false);
    expect(
      getTargetPairEligibility([schedule(), schedule({ id: "late" })], "XAUUSD").eligible,
    ).toBe(false);
    expect(
      getTargetPairEligibility(
        [
          schedule({ scheduleType: "repeating", runTime: "03:30" }),
          schedule({
            id: "late",
            scheduleType: "repeating",
            runTime: "03:30",
            runAt: "2026-09-02T03:30:00.000Z",
          }),
        ],
        "XAUUSD",
      ).eligible,
    ).toBe(false);
    expect(
      getTargetPairEligibility(
        [schedule(), schedule({ id: "late", runAt: "2026-09-02T05:30:00.000Z" })],
        "XAUUSD",
      ).eligible,
    ).toBe(false);
  });
});
