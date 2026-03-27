import { describe, expect, it, vi } from "vitest";
import { CapitalClient, createAppError, normalizeError } from "./client";

describe("CapitalClient", () => {
  it("starts a session with the Capital.com login payload and API key header", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("{}", {
        status: 200,
        headers: {
          CST: "session-cst",
          "X-SECURITY-TOKEN": "security-token",
        },
      });
    });
    const client = new CapitalClient(fetchMock as typeof fetch);

    await client.connect({
      identifier: " trader@example.com ",
      password: "secret",
      apiKey: " api-key ",
      environment: "demo",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("demo-api-capital.backend-capital.com/api/v1/session");
    expect((request.headers as Record<string, string>)["X-CAP-API-KEY"]).toBe("api-key");
    expect(JSON.parse(String(request.body))).toEqual({
      identifier: "trader@example.com",
      password: "secret",
      encryptedPassword: false,
    });
  });

  it("creates and closes a position by following Capital.com deal confirmations", async () => {
    const responses = [
      new Response("{}", {
        status: 200,
        headers: {
          CST: "session-cst",
          "X-SECURITY-TOKEN": "security-token",
        },
      }),
      new Response(JSON.stringify({ dealReference: "o_deal" }), { status: 200 }),
      new Response(
        JSON.stringify({
          dealStatus: "ACCEPTED",
          affectedDeals: [{ dealId: "deal-1" }],
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          position: {
            dealId: "deal-1",
            dealReference: "p_deal-1",
            size: 1,
            direction: "BUY",
            level: 3010.5,
            currency: "USD",
            upl: 12.4,
            createdDateUTC: "2026-03-23T10:00:00.000Z",
          },
          market: {
            epic: "XAUUSD",
            instrumentName: "Spot Gold",
            bid: 3010.2,
            offer: 3010.8,
          },
        }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ dealReference: "p_close" }), { status: 200 }),
      new Response(JSON.stringify({ dealStatus: "ACCEPTED" }), { status: 200 }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? new Response("{}", { status: 500 }));
    const client = new CapitalClient(fetchMock as typeof fetch);

    await client.connect({
      identifier: "trader@example.com",
      password: "secret",
      apiKey: "api-key",
      environment: "demo",
    });
    const opened = await client.openMarketPosition({
      epic: "XAUUSD",
      direction: "BUY",
      size: 1,
    });
    await client.closePosition("deal-1");

    expect(opened?.dealId).toBe("deal-1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/v1/positions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          epic: "XAUUSD",
          direction: "BUY",
          size: 1,
          guaranteedStop: false,
          trailingStop: false,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("/api/v1/positions/deal-1"),
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("loads single market details from the dedicated epic endpoint", async () => {
    const responses = [
      new Response("{}", {
        status: 200,
        headers: {
          CST: "session-cst",
          "X-SECURITY-TOKEN": "security-token",
        },
      }),
      new Response(
        JSON.stringify({
          instrument: {
            epic: "XAUUSD",
            symbol: "Gold",
            name: "Gold vs US Dollar",
            type: "COMMODITIES",
          },
          snapshot: {
            marketStatus: "TRADEABLE",
            bid: 3021.1,
            offer: 3021.7,
            percentageChange: 0.42,
            updateTime: "2026-03-23T09:30:00.000",
          },
        }),
        { status: 200 },
      ),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? new Response("{}", { status: 500 }));
    const client = new CapitalClient(fetchMock as typeof fetch);

    await client.connect({
      identifier: "trader@example.com",
      password: "secret",
      apiKey: "api-key",
      environment: "demo",
    });
    const market = await client.getMarketDetails("XAUUSD");

    expect(market).toEqual({
      epic: "XAUUSD",
      instrumentName: "Gold vs US Dollar",
      symbol: "Gold",
      instrumentType: "COMMODITIES",
      marketStatus: "TRADEABLE",
      bid: 3021.1,
      ask: 3021.7,
      percentageChange: 0.42,
      updateTime: "2026-03-23T09:30:00.000",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/v1/markets/XAUUSD"),
      expect.any(Object),
    );
  });

  it("falls back to the epics query when the dedicated market endpoint returns 404", async () => {
    const responses = [
      new Response("{}", {
        status: 200,
        headers: {
          CST: "session-cst",
          "X-SECURITY-TOKEN": "security-token",
        },
      }),
      new Response(JSON.stringify({ errorCode: "error.not-found" }), { status: 404 }),
      new Response(
        JSON.stringify({
          markets: [
            {
              instrumentName: "Gold",
              epic: "GOLD",
              symbol: "Gold",
              instrumentType: "COMMODITIES",
              marketStatus: "TRADEABLE",
              bid: 3020.1,
              offer: 3020.7,
              percentageChange: 0.18,
              updateTimeUTC: "2026-03-24T01:15:00.000Z",
            },
          ],
        }),
        { status: 200 },
      ),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? new Response("{}", { status: 500 }));
    const client = new CapitalClient(fetchMock as typeof fetch);

    await client.connect({
      identifier: "trader@example.com",
      password: "secret",
      apiKey: "api-key",
      environment: "demo",
    });
    const market = await client.getMarketDetails(" GOLD ");

    expect(market.epic).toBe("GOLD");
    expect(market.instrumentName).toBe("Gold");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/v1/markets/GOLD"),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/api/v1/markets?epics=GOLD"),
      expect.any(Object),
    );
  });

  it("maps historical prices into ADX-ready OHLC bars", async () => {
    const responses = [
      new Response("{}", {
        status: 200,
        headers: {
          CST: "session-cst",
          "X-SECURITY-TOKEN": "security-token",
        },
      }),
      new Response(
        JSON.stringify({
          prices: [
            {
              snapshotTimeUTC: "2026-03-23T09:30:00.000Z",
              highPrice: { bid: 3021.1, ask: 3021.7 },
              lowPrice: { bid: 3010.1, ask: 3010.7 },
              closePrice: { bid: 3015.1, ask: 3015.7 },
            },
          ],
        }),
        { status: 200 },
      ),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? new Response("{}", { status: 500 }));
    const client = new CapitalClient(fetchMock as typeof fetch);

    await client.connect({
      identifier: "trader@example.com",
      password: "secret",
      apiKey: "api-key",
      environment: "demo",
    });
    const prices = await client.getHistoricalPrices("XAUUSD", "MINUTE_15", 10);

    expect(prices).toEqual([
      {
        high: 3021.4,
        low: 3010.4,
        close: 3015.4,
        at: "2026-03-23T09:30:00.000Z",
      },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/v1/prices/XAUUSD?resolution=MINUTE_15&max=10"),
      expect.any(Object),
    );
  });

  it("updates protection with stopLevel and profitLevel and reloads the position", async () => {
    const responses = [
      new Response("{}", {
        status: 200,
        headers: {
          CST: "session-cst",
          "X-SECURITY-TOKEN": "security-token",
        },
      }),
      new Response(JSON.stringify({ dealReference: "p_update" }), { status: 200 }),
      new Response(JSON.stringify({ dealStatus: "ACCEPTED" }), { status: 200 }),
      new Response(
        JSON.stringify({
          position: {
            dealId: "deal-1",
            dealReference: "p_deal-1",
            size: 1,
            direction: "BUY",
            level: 3010.5,
            currency: "USD",
            upl: 12.4,
            createdDateUTC: "2026-03-23T10:00:00.000Z",
            stopLevel: 3000,
            profitLevel: 3030,
          },
          market: {
            epic: "XAUUSD",
            instrumentName: "Spot Gold",
            bid: 3010.2,
            offer: 3010.8,
          },
        }),
        { status: 200 },
      ),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? new Response("{}", { status: 500 }));
    const client = new CapitalClient(fetchMock as typeof fetch);

    await client.connect({
      identifier: "trader@example.com",
      password: "secret",
      apiKey: "api-key",
      environment: "demo",
    });
    const position = await client.updatePositionProtection("deal-1", {
      referencePrice: 3010.8,
      stopLevel: 3000,
      profitLevel: 3030,
      stopDistance: 10.8,
      profitDistance: 19.2,
    });

    expect(position?.stopLevel).toBe(3000);
    expect(position?.profitLevel).toBe(3030);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/v1/positions/deal-1"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          guaranteedStop: false,
          trailingStop: false,
          stopLevel: 3000,
          profitLevel: 3030,
        }),
      }),
    );
  });

  it("reverses a position by closing it and reopening the opposite direction", async () => {
    const responses = [
      new Response("{}", {
        status: 200,
        headers: {
          CST: "session-cst",
          "X-SECURITY-TOKEN": "security-token",
        },
      }),
      new Response(
        JSON.stringify({
          positions: [
            {
              position: {
                dealId: "deal-1",
                dealReference: "p_deal-1",
                size: 2,
                direction: "BUY",
                level: 3010.5,
                currency: "USD",
                upl: 12.4,
                createdDateUTC: "2026-03-23T10:00:00.000Z",
              },
              market: {
                epic: "XAUUSD",
                instrumentName: "Spot Gold",
                bid: 3010.2,
                offer: 3010.8,
              },
            },
          ],
        }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ dealReference: "p_close" }), { status: 200 }),
      new Response(JSON.stringify({ dealStatus: "ACCEPTED" }), { status: 200 }),
      new Response(JSON.stringify({ dealReference: "o_deal" }), { status: 200 }),
      new Response(
        JSON.stringify({
          dealStatus: "ACCEPTED",
          affectedDeals: [{ dealId: "deal-2" }],
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          position: {
            dealId: "deal-2",
            dealReference: "p_deal-2",
            size: 2,
            direction: "SELL",
            level: 3011.2,
            currency: "USD",
            upl: 0,
            createdDateUTC: "2026-03-23T10:02:00.000Z",
          },
          market: {
            epic: "XAUUSD",
            instrumentName: "Spot Gold",
            bid: 3011.0,
            offer: 3011.4,
          },
        }),
        { status: 200 },
      ),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? new Response("{}", { status: 500 }));
    const client = new CapitalClient(fetchMock as typeof fetch);

    await client.connect({
      identifier: "trader@example.com",
      password: "secret",
      apiKey: "api-key",
      environment: "demo",
    });
    const reversed = await client.reversePosition("deal-1");

    expect(reversed?.dealId).toBe("deal-2");
    expect(reversed?.direction).toBe("SELL");
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/api/v1/positions/deal-1"),
      expect.objectContaining({
        method: "DELETE",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("/api/v1/positions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          epic: "XAUUSD",
          direction: "SELL",
          size: 2,
          guaranteedStop: false,
          trailingStop: false,
        }),
      }),
    );
  });

  it("redacts API keys from surfaced app errors", () => {
    const appError = createAppError(
      "CAPITAL_401",
      "Auth failed for CAP-SECRETKEY1234",
      true,
      'Request used "apiKey":"CAP-SECRETKEY1234"',
    );

    expect(appError.message).not.toContain("SECRETKEY1234");
    expect(appError.detail).toContain("****");

    const normalized = normalizeError(new Error("X-CAP-API-KEY: CAP-SECRETKEY1234"));
    expect(normalized.message).toContain("****");
  });
});
