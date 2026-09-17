import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands.mjs";

describe("CLI command parsing", () => {
  it("maps a market order to the shared app operation", () => {
    expect(
      parseCommand([
        "orders",
        "open",
        "GOLD",
        "--direction",
        "buy",
        "--size",
        "0.25",
        "--protection",
        '{"stopLoss":{"mode":"distance","distance":20},"takeProfit":{"mode":"none"}}',
        "--yes",
      ]),
    ).toMatchObject({
      method: "orders.openMarket",
      assumeYes: true,
      requiresConfirmation: true,
      input: {
        epic: "GOLD",
        direction: "BUY",
        size: 0.25,
        protection: {
          stopLoss: { mode: "distance", distance: 20 },
          takeProfit: { mode: "none" },
        },
      },
    });
  });

  it("reads credentials from environment variables", () => {
    const command = parseCommand(["auth", "connect"], {
      CAPITALCOM_IDENTIFIER: "account-id",
      CAPITALCOM_PASSWORD: "password",
      CAPITALCOM_API_KEY: "api-key",
      CAPITALCOM_ENVIRONMENT: "live",
    });

    expect(command).toMatchObject({
      method: "auth.connect",
      input: {
        identifier: "account-id",
        password: "password",
        apiKey: "api-key",
        environment: "live",
      },
    });
  });

  it("supports raw method calls for automation", () => {
    expect(parseCommand(["call", "markets.select", "--input", '"XAUUSD"'])).toMatchObject({
      method: "markets.select",
      input: "XAUUSD",
      requiresConfirmation: false,
    });
  });

  it("accepts pnpm's argument separator before global options", () => {
    expect(parseCommand(["--", "--help"])).toEqual({ help: true, compact: false });
  });

  it("rejects invalid numeric arguments before contacting the app", () => {
    expect(() =>
      parseCommand(["orders", "open", "GOLD", "--direction", "BUY", "--size", "zero"]),
    ).toThrow("--size must be greater than 0");
  });

  it("maps dedicated target-position enable and disable commands", () => {
    expect(parseCommand([
      "target-position",
      "enable",
      "schedule-early",
      "--direction",
      "sell",
      "--size",
      "1.25",
    ])).toMatchObject({
      method: "targetPosition.update",
      requiresConfirmation: true,
      input: {
        jobId: "schedule-early",
        targetPosition: { enabled: true, direction: "SELL", size: 1.25 },
      },
    });

    expect(parseCommand(["target-position", "disable", "schedule-late"])).toMatchObject({
      method: "targetPosition.update",
      requiresConfirmation: true,
      input: { jobId: "schedule-late", targetPosition: { enabled: false } },
    });
  });
});
