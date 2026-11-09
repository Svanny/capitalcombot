import { describe, expect, it } from "vitest";
import { createAppError } from "./capital/client";
import { marketReopeningBefore } from "./market-reopening";

const closedGold = createAppError("CAPITAL_400", "Capital.com request failed.", false,
  "Rejected. GOLD is currently closed. Timetable in place: UTC; Mon - 21:59, 23:00 -; Tue - 21:59, 23:00 -; Wed - 21:59, 23:00 -; Thu - 21:59, 23:00 -; Fri - 21:59; Sun 23:00 -.");

describe("marketReopeningBefore", () => {
  it.each(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"])(
    "uses the UTC winter reopening on %s", (date) => {
      const now = Date.parse(`${date}T22:30:00Z`);
      expect(marketReopeningBefore(closedGold, "GOLD", now, now + 86_400_000)?.toISOString())
        .toBe(`${date}T23:00:05.000Z`);
    },
  );
  it.each(["2026-11-13", "2026-11-14"])("does not carry weekend orders into the next daily run: %s", (date) => {
    const now = Date.parse(`${date}T22:30:00Z`);
    expect(marketReopeningBefore(closedGold, "GOLD", now, now + 86_400_000)).toBeNull();
  });
  it("does not loop when the opening has already passed", () => {
    const now = Date.parse("2026-11-09T23:00:05Z");
    expect(marketReopeningBefore(closedGold, "GOLD", now, Date.parse("2026-11-10T22:30:00Z"))).toBeNull();
  });
  it.each([
    { ...closedGold, code: "CAPITAL_500" },
    { ...closedGold, code: "DEAL_CONFIRM_TIMEOUT" },
    { ...closedGold, detail: closedGold.detail?.replace("GOLD", "SILVER") },
    { ...closedGold, detail: closedGold.detail?.replace("UTC", "Europe/London") },
    { ...closedGold, detail: closedGold.detail?.replace("23:00", "25:00") },
    { ...closedGold, detail: closedGold.detail?.replace("23:00", "23:99") },
    { ...closedGold, detail: "error.market.closed" },
  ])("does not retry uncertain outcomes or unsupported timetables", (error) => {
    const now = Date.parse("2026-11-09T22:30:00Z");
    expect(marketReopeningBefore(error, "GOLD", now, now + 86_400_000)).toBeNull();
  });
});
