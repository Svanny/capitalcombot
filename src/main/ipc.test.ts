import { describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import type {
  CapitalCredentials,
  MarketSummary,
  OpenPosition,
  ProtectionStrategy,
  QuoteSnapshot,
  ScheduledOrderJob,
} from "../shared/types";
import { IPC_CHANNELS } from "../shared/ipc";
import {
  createIpcHandlers,
  registerIpcHandlers,
  type SchedulerLike,
  type TradingClientLike,
} from "./ipc";
import { MemoryCredentialStore } from "./security/credential-store";
import { MemoryAppStateStore } from "./state/app-store";

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 0 })),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

function buildOpenPosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    dealId: "deal-1",
    dealReference: "p_deal-1",
    epic: "XAUUSD",
    instrumentName: "Spot Gold",
    direction: "BUY",
    size: 1,
    level: 3010.5,
    currency: "USD",
    pnl: 0,
    bid: 3010.1,
    ask: 3010.8,
    createdAt: "2026-03-23T10:00:00.000Z",
    stopLevel: null,
    profitLevel: null,
    ...overrides,
  };
}

function createMockClient(): TradingClientLike {
  let connected = false;

  return {
    connect: vi.fn(async () => {
      connected = true;
    }),
    disconnect: vi.fn(async () => {
      connected = false;
    }),
    isConnected: vi.fn(() => connected),
    searchGoldMarkets: vi.fn(async () => [
      {
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        symbol: "XAUUSD",
        instrumentType: "COMMODITIES",
        marketStatus: "TRADEABLE",
        bid: 3010.1,
        ask: 3010.8,
        percentageChange: 0.4,
        updateTime: "2026-03-23T10:00:00.000Z",
      } satisfies MarketSummary,
    ]),
    getMarketDetails: vi.fn(async () => ({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      symbol: "XAUUSD",
      instrumentType: "COMMODITIES",
      marketStatus: "TRADEABLE",
      bid: 3010.1,
      ask: 3010.8,
      percentageChange: 0.4,
      updateTime: "2026-03-23T10:00:00.000Z",
    })),
    getQuote: vi.fn(async () => ({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      bid: 3010.1,
      ask: 3010.8,
      marketStatus: "TRADEABLE",
      percentageChange: 0.4,
      updateTime: "2026-03-23T10:00:00.000Z",
    } satisfies QuoteSnapshot)),
    getHistoricalPrices: vi.fn(async () =>
      Array.from({ length: 30 }, (_, index) => ({
        high: 3015 + index,
        low: 3005 + index,
        close: 3010 + index,
        at: new Date(Date.parse("2026-03-23T10:00:00.000Z") + index * 900_000).toISOString(),
      })),
    ),
    getAccountPreferences: vi.fn(async () => ({ hedgingMode: false })),
    listPositions: vi.fn(async () => [] satisfies OpenPosition[]),
    openMarketPosition: vi.fn(async () => buildOpenPosition()),
    closePosition: vi.fn(async () => undefined),
    reversePosition: vi.fn(async () =>
      buildOpenPosition({
        dealId: "deal-2",
        dealReference: "p_deal-2",
        direction: "SELL",
        level: 3011.2,
        bid: 3011.0,
        ask: 3011.4,
        createdAt: "2026-03-23T10:01:00.000Z",
      }),
    ),
    updatePositionProtection: vi.fn(async (_dealId, resolvedProtection) =>
      buildOpenPosition({
        stopLevel: resolvedProtection.stopLevel,
        profitLevel: resolvedProtection.profitLevel,
      }),
    ),
  };
}

function createMockScheduler(): SchedulerLike {
  const schedules: ScheduledOrderJob[] = [];

  return {
    list: vi.fn(() => schedules.slice()),
    schedule: vi.fn((input) => {
      const job: ScheduledOrderJob = {
        id: `schedule_${input.epic}`,
        epic: input.epic,
        instrumentName: input.instrumentName,
        direction: input.direction,
        size: input.size,
        scheduleType: input.type,
        runAt: input.type === "one-off" ? input.runAt : "2026-03-23T11:00:00.000Z",
        runTime: input.type === "repeating" ? input.runTime : undefined,
        status: "scheduled",
        createdAt: "2026-03-23T10:00:00.000Z",
        protection: input.protection ?? null,
      };
      schedules.push(job);
      return job;
    }),
    cancel: vi.fn((jobId: string) =>
      schedules.map((job) =>
        job.id === jobId && job.status === "scheduled"
          ? { ...job, status: "cancelled" as const, reason: "Cancelled manually" }
          : job,
      ),
    ),
    pause: vi.fn((jobId: string) => {
      const nextSchedules = schedules.map((job) =>
        job.id === jobId && job.status === "scheduled"
          ? { ...job, status: "paused" as const, reason: "Paused manually" }
          : job,
      );
      schedules.splice(0, schedules.length, ...nextSchedules);
      return schedules.slice();
    }),
    reactivate: vi.fn((jobId: string) => {
      const current = schedules.find((job) => job.id === jobId);

      if (!current) {
        throw new Error("missing schedule");
      }

      const nextJob: ScheduledOrderJob = {
        ...current,
        status: "scheduled",
        reason: "Scheduled order reactivated.",
      };
      const index = schedules.findIndex((job) => job.id === jobId);
      schedules.splice(index, 1, nextJob);
      return nextJob;
    }),
    update: vi.fn((jobId, input) => {
      const current = schedules.find((job) => job.id === jobId);

      if (!current) {
        throw new Error("missing schedule");
      }

      const nextJob: ScheduledOrderJob = {
        ...current,
        direction: input.direction,
        size: input.size,
        scheduleType: input.type,
        runAt: input.type === "one-off" ? input.runAt : "2026-03-23T14:30:00.000Z",
        runTime: input.type === "repeating" ? input.runTime : undefined,
        protection: input.protection ?? null,
        targetPosition: input.targetPosition?.enabled
          ? {
              pairId: "pair-1",
              leg: "early",
              direction: input.targetPosition.direction,
              size: input.targetPosition.size,
            }
          : null,
        reason: undefined,
      };
      const index = schedules.findIndex((job) => job.id === jobId);
      schedules.splice(index, 1, nextJob);
      return nextJob;
    }),
  };
}

describe("createIpcHandlers", () => {
  it("connects, saves credentials, and returns bootstrap state", async () => {
    const store = new MemoryAppStateStore();
    const credentials = new MemoryCredentialStore();
    const client = createMockClient();
    const handlers = createIpcHandlers({
      client,
      store,
      credentials,
      scheduler: createMockScheduler(),
    });
    const input: CapitalCredentials = {
      identifier: "trader@example.com",
      password: "secret",
      apiKey: "api-key",
      environment: "demo",
    };

    const response = await handlers.connect(input);

    expect(response.state.connected).toBe(true);
    expect(response.state.savedProfile?.identifier).toBe("trader@example.com");
    expect(await credentials.getSavedProfile()).toEqual({
      identifier: "trader@example.com",
      environment: "demo",
    });
  });

  it("queues a scheduled order instead of placing it immediately", async () => {
    const store = new MemoryAppStateStore();
    store.patchState({
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
    });
    const client = createMockClient();
    const scheduler = createMockScheduler();
    const handlers = createIpcHandlers({
      client,
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
    });

    const response = await handlers.openMarket({
      epic: "XAUUSD",
      direction: "BUY",
      size: 1,
      schedule: {
        type: "one-off",
        runAt: "2026-03-23T11:00:00.000Z",
      },
    });

    expect(response.position).toBeNull();
    expect(response.schedule?.status).toBe("scheduled");
    expect(client.openMarketPosition).not.toHaveBeenCalled();
    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        type: "one-off",
      }),
    );
  });

  it("persists protection strategy on a scheduled order without placing it", async () => {
    const store = new MemoryAppStateStore();
    store.patchState({
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
    });
    const client = createMockClient();
    const scheduler = createMockScheduler();
    const handlers = createIpcHandlers({
      client,
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
    });
    const protection: ProtectionStrategy = {
      stopLoss: { mode: "distance", distance: 10 },
      takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
    };

    const response = await handlers.openMarket({
      epic: "XAUUSD",
      direction: "BUY",
      size: 1,
      schedule: {
        type: "one-off",
        runAt: "2026-03-23T11:00:00.000Z",
      },
      protection,
    });

    expect(response.schedule?.protection).toEqual(protection);
    expect(client.openMarketPosition).not.toHaveBeenCalled();
  });

  it("reverses a position and keeps scheduled orders unchanged", async () => {
    const store = new MemoryAppStateStore();
    const scheduler = createMockScheduler();
    const scheduledOrders: ScheduledOrderJob[] = [
      {
        id: "schedule_deal-1",
        epic: "XAUUSD",
        instrumentName: "Spot Gold",
        direction: "BUY",
        size: 1,
        scheduleType: "one-off",
        runAt: "2026-03-23T11:00:00.000Z",
        status: "scheduled",
        createdAt: "2026-03-23T10:00:00.000Z",
      },
    ];
    scheduler.list = vi.fn(() => scheduledOrders);
    const client = createMockClient();
    const handlers = createIpcHandlers({
      client,
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
    });

    const response = await handlers.reversePosition("deal-1");

    expect(response.position?.dealId).toBe("deal-2");
    expect(response.schedules).toEqual(scheduledOrders);
    expect(client.reversePosition).toHaveBeenCalledWith("deal-1");
  });

  it("cancels a scheduled order by job id", async () => {
    const store = new MemoryAppStateStore();
    const scheduler = createMockScheduler();
    await scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T11:00:00.000Z",
    });
    const handlers = createIpcHandlers({
      client: createMockClient(),
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
    });

    const response = await handlers.cancelSchedule("schedule_XAUUSD");

    expect(response.schedules[0]?.status).toBe("cancelled");
    expect(scheduler.cancel).toHaveBeenCalledWith("schedule_XAUUSD");
  });

  it("pauses a scheduled order by job id", async () => {
    const store = new MemoryAppStateStore();
    const scheduler = createMockScheduler();
    await scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T11:00:00.000Z",
    });
    const handlers = createIpcHandlers({
      client: createMockClient(),
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
    });

    const response = await handlers.pauseSchedule({ jobId: "schedule_XAUUSD" });

    expect(response.schedules[0]?.status).toBe("paused");
    expect(response.result.message).toBe("Paused scheduled order.");
    expect(scheduler.pause).toHaveBeenCalledWith("schedule_XAUUSD");
  });

  it("reactivates a paused or cancelled scheduled order by job id", async () => {
    const store = new MemoryAppStateStore();
    const scheduler = createMockScheduler();
    await scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T11:00:00.000Z",
    });
    scheduler.pause("schedule_XAUUSD");
    const handlers = createIpcHandlers({
      client: createMockClient(),
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
    });

    const response = await handlers.reactivateSchedule({ jobId: "schedule_XAUUSD" });

    expect(response.schedules[0]?.status).toBe("scheduled");
    expect(response.result.message).toBe("Reactivated scheduled order for Spot Gold.");
    expect(scheduler.reactivate).toHaveBeenCalledWith("schedule_XAUUSD");
  });

  it("updates a scheduled order by job id", async () => {
    const store = new MemoryAppStateStore();
    const scheduler = createMockScheduler();
    await scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T11:00:00.000Z",
    });
    const handlers = createIpcHandlers({
      client: createMockClient(),
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
    });

    const response = await handlers.updateSchedule({
      jobId: "schedule_XAUUSD",
      direction: "SELL",
      size: 2,
      schedule: {
        type: "repeating",
        runTime: "14:30",
      },
      protection: {
        stopLoss: { mode: "distance", distance: 10 },
        takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
      },
    });

    expect(response.schedules[0]).toMatchObject({
      id: "schedule_XAUUSD",
      direction: "SELL",
      size: 2,
      scheduleType: "repeating",
      runTime: "14:30",
    });
    expect(scheduler.update).toHaveBeenCalledWith(
      "schedule_XAUUSD",
      expect.objectContaining({
        direction: "SELL",
        size: 2,
        type: "repeating",
        runTime: "14:30",
      }),
    );
  });

  it("blocks target-position activation when broker hedging mode is enabled", async () => {
    const store = new MemoryAppStateStore();
    const scheduler = createMockScheduler();
    await scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "one-off",
      runAt: "2026-03-23T11:00:00.000Z",
    });
    const client = createMockClient();
    vi.mocked(client.getAccountPreferences).mockResolvedValue({ hedgingMode: true });
    const handlers = createIpcHandlers({
      client,
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
    });

    await expect(
      handlers.updateSchedule({
        jobId: "schedule_XAUUSD",
        direction: "SELL",
        size: 2,
        schedule: { type: "one-off", runAt: "2026-03-23T11:00:00.000Z" },
        protection: null,
        targetPosition: { enabled: true, direction: "SELL", size: 2 },
      }),
    ).rejects.toThrow(/HEDGING_MODE_ENABLED/);
    expect(scheduler.update).not.toHaveBeenCalled();
  });

  it("uses live exposure and skips confirmation when saving target-position changes", async () => {
    const store = new MemoryAppStateStore();
    const scheduler = createMockScheduler();
    await scheduler.schedule({
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      type: "repeating",
      runTime: "03:30",
    });
    const client = createMockClient();
    vi.mocked(client.listPositions).mockResolvedValue([buildOpenPosition({ direction: "BUY", size: 1 })]);
    const userPresence = { confirm: vi.fn(async () => false) };
    const handlers = createIpcHandlers({
      client,
      store,
      credentials: new MemoryCredentialStore(),
      scheduler,
      userPresence,
    });

    await handlers.updateSchedule({
      jobId: "schedule_XAUUSD",
      direction: "BUY",
      size: 1,
      schedule: { type: "repeating", runTime: "03:30" },
      protection: null,
      targetPosition: { enabled: true, direction: "BUY", size: 1 },
    });

    expect(userPresence.confirm).not.toHaveBeenCalled();
    expect(client.listPositions).toHaveBeenCalledTimes(1);
    expect(scheduler.update).toHaveBeenCalledWith(
      "schedule_XAUUSD",
      expect.objectContaining({ targetCurrentPosition: 1 }),
    );
  });

  it("previews protection in the main process", async () => {
    const handlers = createIpcHandlers({
      client: createMockClient(),
      store: new MemoryAppStateStore(),
      credentials: new MemoryCredentialStore(),
      scheduler: createMockScheduler(),
    });

    const response = await handlers.previewProtection({
      epic: "XAUUSD",
      direction: "BUY",
      protection: {
        stopLoss: { mode: "distance", distance: 10 },
        takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
      },
    });

    expect(response.preview?.stopDistance).toBe(10);
    expect(response.preview?.profitLevel).not.toBeNull();
  });

  it("updates position protection from a resolved strategy", async () => {
    const client = createMockClient();
    const handlers = createIpcHandlers({
      client,
      store: new MemoryAppStateStore(),
      credentials: new MemoryCredentialStore(),
      scheduler: createMockScheduler(),
    });

    const response = await handlers.updatePositionProtection({
      dealId: "deal-1",
      epic: "XAUUSD",
      direction: "BUY",
      protection: {
        stopLoss: { mode: "distance", distance: 10 },
        takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
      },
    });

    expect(client.updatePositionProtection).toHaveBeenCalledWith(
      "deal-1",
      expect.objectContaining({
        stopLevel: expect.any(Number),
        profitLevel: expect.any(Number),
      }),
    );
    expect(response.position?.stopLevel).not.toBeNull();
    expect(response.position?.profitLevel).not.toBeNull();
  });

  it("rejects invalid renderer payloads before they reach privileged order actions", async () => {
    const client = createMockClient();
    const handlers = createIpcHandlers({
      client,
      store: new MemoryAppStateStore(),
      credentials: new MemoryCredentialStore(),
      scheduler: createMockScheduler(),
    });

    await expect(
      handlers.openMarket({
        epic: "",
        direction: "BUY",
        size: 1,
      } as never),
    ).rejects.toThrow(/INVALID_INPUT/);
    expect(client.openMarketPosition).not.toHaveBeenCalled();
  });

  it("rejects malformed protection updates at the IPC boundary", async () => {
    const client = createMockClient();
    const handlers = createIpcHandlers({
      client,
      store: new MemoryAppStateStore(),
      credentials: new MemoryCredentialStore(),
      scheduler: createMockScheduler(),
    });

    await expect(
      handlers.updatePositionProtection({
        dealId: "deal-1",
        epic: "XAUUSD",
        direction: "BUY",
        protection: {
          stopLoss: { mode: "distance", distance: -10 },
          takeProfit: { mode: "risk_reward", riskRewardRatio: 2 },
        },
      } as never),
    ).rejects.toThrow(/INVALID_INPUT/);
    expect(client.updatePositionProtection).not.toHaveBeenCalled();
  });

  it("requires main-process user presence before placing market orders", async () => {
    const client = createMockClient();
    const userPresence = {
      confirm: vi.fn(async () => false),
    };
    const handlers = createIpcHandlers({
      client,
      store: new MemoryAppStateStore(),
      credentials: new MemoryCredentialStore(),
      scheduler: createMockScheduler(),
      userPresence,
    });

    await expect(
      handlers.openMarket({
        epic: "XAUUSD",
        direction: "BUY",
        size: 1,
      }),
    ).rejects.toThrow(/USER_PRESENCE_REQUIRED/);

    expect(userPresence.confirm).toHaveBeenCalledWith(
      "openMarket",
      "Place a BUY market order for 1 XAUUSD.",
    );
    expect(client.openMarketPosition).not.toHaveBeenCalled();
  });

  it("requires main-process user presence before reusing saved credentials", async () => {
    const client = createMockClient();
    const credentials = new MemoryCredentialStore();
    await credentials.save({
      identifier: "trader@example.com",
      password: "secret",
      apiKey: "api-key",
      environment: "demo",
    });
    const handlers = createIpcHandlers({
      client,
      store: new MemoryAppStateStore(),
      credentials,
      scheduler: createMockScheduler(),
      userPresence: {
        confirm: vi.fn(async () => false),
      },
    });

    await expect(handlers.connectSaved()).rejects.toThrow(/Confirm the Capital.com action/);

    expect(client.connect).not.toHaveBeenCalled();
  });

  it("returns saved credentials only from the explicit connect-saved action", async () => {
    const credentials = new MemoryCredentialStore();
    const saved: CapitalCredentials = {
      identifier: "saved@example.com",
      password: "saved-password",
      apiKey: "saved-api-key",
      environment: "live",
    };
    await credentials.save(saved);
    const handlers = createIpcHandlers({
      client: createMockClient(),
      store: new MemoryAppStateStore(),
      credentials,
      scheduler: createMockScheduler(),
    });

    const bootstrap = await handlers.bootstrap();
    const response = await handlers.connectSaved();

    expect(bootstrap).not.toHaveProperty("credentials");
    expect(response.credentials).toEqual(saved);
  });

  it("requires main-process user presence before pausing or reactivating schedules", async () => {
    const scheduler = createMockScheduler();
    const userPresence = {
      confirm: vi.fn(async () => false),
    };
    const handlers = createIpcHandlers({
      client: createMockClient(),
      store: new MemoryAppStateStore(),
      credentials: new MemoryCredentialStore(),
      scheduler,
      userPresence,
    });

    await expect(handlers.pauseSchedule({ jobId: "schedule_XAUUSD" })).rejects.toThrow(
      /USER_PRESENCE_REQUIRED/,
    );
    await expect(handlers.reactivateSchedule({ jobId: "schedule_XAUUSD" })).rejects.toThrow(
      /USER_PRESENCE_REQUIRED/,
    );

    expect(userPresence.confirm).toHaveBeenCalledWith(
      "pauseSchedule",
      "Pause scheduled order schedule_XAUUSD.",
    );
    expect(userPresence.confirm).toHaveBeenCalledWith(
      "reactivateSchedule",
      "Reactivate scheduled order schedule_XAUUSD.",
    );
    expect(scheduler.pause).not.toHaveBeenCalled();
    expect(scheduler.reactivate).not.toHaveBeenCalled();
  });

  it("validates registered IPC payloads before dereferencing privileged identifiers", async () => {
    vi.mocked(ipcMain.handle).mockClear();
    const client = createMockClient();

    await registerIpcHandlers({
      client,
      store: new MemoryAppStateStore(),
      credentials: new MemoryCredentialStore(),
      scheduler: createMockScheduler(),
    });

    const registrations = new Map(vi.mocked(ipcMain.handle).mock.calls);
    const close = registrations.get(IPC_CHANNELS.POSITIONS_CLOSE);
    const reverse = registrations.get(IPC_CHANNELS.POSITIONS_REVERSE);
    const cancel = registrations.get(IPC_CHANNELS.SCHEDULES_CANCEL);
    const pause = registrations.get(IPC_CHANNELS.SCHEDULES_PAUSE);
    const reactivate = registrations.get(IPC_CHANNELS.SCHEDULES_REACTIVATE);
    const update = registrations.get(IPC_CHANNELS.SCHEDULES_UPDATE);

    expect(close).toBeTypeOf("function");
    expect(reverse).toBeTypeOf("function");
    expect(cancel).toBeTypeOf("function");
    expect(pause).toBeTypeOf("function");
    expect(reactivate).toBeTypeOf("function");
    expect(update).toBeTypeOf("function");

    await expect(close?.({} as never, null)).rejects.toThrow(/INVALID_INPUT/);
    await expect(reverse?.({} as never, null)).rejects.toThrow(/INVALID_INPUT/);
    await expect(cancel?.({} as never, null)).rejects.toThrow(/INVALID_INPUT/);
    await expect(pause?.({} as never, null)).rejects.toThrow(/INVALID_INPUT/);
    await expect(reactivate?.({} as never, null)).rejects.toThrow(/INVALID_INPUT/);
    await expect(update?.({} as never, null)).rejects.toThrow(/INVALID_INPUT/);
    expect(client.closePosition).not.toHaveBeenCalled();
    expect(client.reversePosition).not.toHaveBeenCalled();
  });
});
