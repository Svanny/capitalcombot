import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands.mjs";

describe("CLI command parsing", () => {
  it.each([
    ["status", "app.bootstrap"], ["quote", "quotes.getSelected"],
    ["auth connect-saved", "auth.connectSaved"], ["auth disconnect", "auth.disconnect"],
    ["auth forget-saved", "auth.forgetSaved"], ["markets search Spot Gold", "markets.searchGold"],
    ["markets select GOLD", "markets.select"], ["positions list", "positions.listOpen"],
    ["positions close deal", "positions.close"], ["positions reverse deal", "positions.reverse"],
    ["positions protect deal --epic GOLD --direction BUY --protection {}", "positions.updateProtection"],
    ["orders open GOLD --direction BUY --size 1 --schedule {} --protection {}", "orders.openMarket"],
    ["orders preview GOLD --direction BUY --protection {}", "orders.previewProtection"],
    ["schedules list", "schedules.list"], ["schedules cancel job", "schedules.cancel"],
    ["schedules pause job", "schedules.pause"], ["schedules reactivate job", "schedules.reactivate"],
    ["schedules update job --direction BUY --size 1 --schedule {} --protection {} --target-position {}", "schedules.update"],
  ])("accepts documented command shape: %s", (command, method) => {
    expect(parseCommand([...command.split(" "), "--compact", "-y"])).toMatchObject({ method, compact: true, assumeYes: true });
  });

  it.each([
    ["orders", "open", "GOLD", "--direction", "BUY", "--size", "1", "--schedul", "{}"],
    ["positions", "close", "deal-1", "deal-2", "--yes"],
    ["positions", "list", "--size", "2"],
    ["status", "--yes=false"],
    ["status", "--compact=false"],
    ["status", "--help=false"],
    ["orders", "open", "GOLD", "--direction", "BUY", "--size", "1", "--size", "2"],
    ["status", "--__proto__", "x"],
    ["status", "--constructor", "x"],
    ["status", "-z"],
    ["auth", "disconnect", "extra"],
    ["call", "positions.close", "extra", "--input", "{}"],
  ])("rejects ambiguous or ignored arguments: %j", (...argv) => {
    expect(() => parseCommand(argv)).toThrow();
  });

  it("preserves password whitespace", () => {
    expect(parseCommand(["auth", "connect"], {
      CAPITALCOM_IDENTIFIER: "account", CAPITALCOM_PASSWORD: " secret ", CAPITALCOM_API_KEY: "key",
    }).input.password).toBe(" secret ");
  });
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
