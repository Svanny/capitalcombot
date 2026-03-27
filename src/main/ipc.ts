import { IPC_CHANNELS } from "../shared/ipc";
import type {
  AppError,
  AuthResponse,
  BootstrapState,
  CancelScheduledOrderResponse,
  CapitalCredentials,
  ClosePositionResponse,
  MarketSummary,
  OpenMarketOrderInput,
  OpenMarketOrderResponse,
  OpenPosition,
  ProtectionStrategy,
  ProtectionPreviewInput,
  ProtectionPreviewResponse,
  QuoteSnapshot,
  ReversePositionResponse,
  ScheduledOrderJob,
  UpdatePositionProtectionInput,
  UpdatePositionProtectionResponse,
} from "../shared/types";
import { createAppError, normalizeError } from "./trading/capital/client";
import type { CredentialStore } from "./security/credential-store";
import { buildExecutionResult, type AppStateStore } from "./state/app-store";
import { resolveProtection } from "./trading/protection";
import type { ScheduledOrderInput } from "./trading/scheduler";

export interface TradingClientLike {
  connect(credentials: CapitalCredentials): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  searchGoldMarkets(query: string): Promise<MarketSummary[]>;
  getMarketDetails(epic: string): Promise<MarketSummary>;
  getQuote(epic: string): Promise<QuoteSnapshot>;
  getHistoricalPrices(epic: string, resolution: "MINUTE_15", max: number): Promise<import("./trading/protection").HistoricalPriceBar[]>;
  listPositions(): Promise<OpenPosition[]>;
  openMarketPosition(
    input: OpenMarketOrderInput,
    resolvedProtection?: import("../shared/types").ResolvedProtection | null,
  ): Promise<OpenPosition | null>;
  closePosition(dealId: string): Promise<void>;
  reversePosition(dealId: string): Promise<OpenPosition | null>;
  updatePositionProtection(
    dealId: string,
    resolvedProtection: import("../shared/types").ResolvedProtection,
  ): Promise<OpenPosition | null>;
}

export interface SchedulerLike {
  list(): ScheduledOrderJob[];
  schedule(input: ScheduledOrderInput): ScheduledOrderJob;
  cancel(jobId: string, reason?: string): ScheduledOrderJob[];
}

export interface IpcDependencies {
  client: TradingClientLike;
  store: AppStateStore;
  credentials: CredentialStore;
  scheduler: SchedulerLike;
}

export async function registerIpcHandlers(dependencies: IpcDependencies): Promise<void> {
  const { ipcMain } = await import("electron");
  const handlers = createIpcHandlers(dependencies);

  ipcMain.handle(IPC_CHANNELS.APP_BOOTSTRAP, handlers.bootstrap);
  ipcMain.handle(IPC_CHANNELS.AUTH_CONNECT, (_event, credentials: CapitalCredentials) =>
    handlers.connect(credentials),
  );
  ipcMain.handle(IPC_CHANNELS.AUTH_CONNECT_SAVED, handlers.connectSaved);
  ipcMain.handle(IPC_CHANNELS.AUTH_DISCONNECT, handlers.disconnect);
  ipcMain.handle(IPC_CHANNELS.AUTH_FORGET_SAVED, handlers.forgetSaved);
  ipcMain.handle(IPC_CHANNELS.MARKETS_SEARCH_GOLD, (_event, query: string) =>
    handlers.searchGold(query),
  );
  ipcMain.handle(IPC_CHANNELS.MARKETS_SELECT, (_event, epic: string) => handlers.selectMarket(epic));
  ipcMain.handle(IPC_CHANNELS.QUOTES_GET_SELECTED, handlers.getSelectedQuote);
  ipcMain.handle(IPC_CHANNELS.POSITIONS_LIST_OPEN, handlers.listPositions);
  ipcMain.handle(IPC_CHANNELS.ORDERS_OPEN_MARKET, (_event, input: OpenMarketOrderInput) =>
    handlers.openMarket(input),
  );
  ipcMain.handle(IPC_CHANNELS.ORDERS_PREVIEW_PROTECTION, (_event, input: ProtectionPreviewInput) =>
    handlers.previewProtection(input),
  );
  ipcMain.handle(IPC_CHANNELS.POSITIONS_CLOSE, (_event, input: unknown) => handlers.closePosition(input));
  ipcMain.handle(IPC_CHANNELS.POSITIONS_REVERSE, (_event, input: unknown) => handlers.reversePosition(input));
  ipcMain.handle(
    IPC_CHANNELS.POSITIONS_UPDATE_PROTECTION,
    (_event, input: UpdatePositionProtectionInput) => handlers.updatePositionProtection(input),
  );
  ipcMain.handle(IPC_CHANNELS.SCHEDULES_LIST, handlers.listSchedules);
  ipcMain.handle(IPC_CHANNELS.SCHEDULES_CANCEL, (_event, input: unknown) => handlers.cancelSchedule(input));
}

export function createIpcHandlers({ client, store, credentials, scheduler }: IpcDependencies) {
  const previewProtection = async (
    unsafeInput: unknown,
  ): Promise<ProtectionPreviewResponse> => {
    try {
      const input = validateProtectionPreviewInput(unsafeInput);
      return {
        preview: await resolveProtection(client, input),
      };
    } catch (error) {
      throw serializeError(normalizeError(error));
    }
  };

  const connect = async (unsafeInput: unknown): Promise<AuthResponse> => {
    try {
      const input = validateCapitalCredentials(unsafeInput);
      await client.connect(input);
      await credentials.save(input);
      store.patchState({
        environment: input.environment,
        savedProfile: {
          identifier: input.identifier.trim(),
          environment: input.environment,
        },
      });
      const result = buildExecutionResult(
        "auth",
        "success",
        `Connected to Capital.com ${input.environment} environment.`,
      );
      store.appendExecution(result);
      return {
        state: buildBootstrapState(client, store, await credentials.getSavedProfile()),
        result,
      };
    } catch (error) {
      throw serializeError(normalizeError(error));
    }
  };

  return {
    bootstrap: async (): Promise<BootstrapState> => {
      return buildBootstrapState(client, store, await credentials.getSavedProfile());
    },

    connect,

    connectSaved: async (): Promise<AuthResponse> => {
      const saved = await credentials.load();

      if (!saved) {
        throw serializeError(
          createAppError("MISSING_SAVED_CREDENTIALS", "No saved Capital.com credentials were found."),
        );
      }

      return connect(saved);
    },

    disconnect: async (): Promise<AuthResponse> => {
      try {
        await client.disconnect();
        const result = buildExecutionResult("auth", "info", "Disconnected from Capital.com.");
        store.appendExecution(result);
        return {
          state: buildBootstrapState(client, store, await credentials.getSavedProfile()),
          result,
        };
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    forgetSaved: async (): Promise<BootstrapState> => {
      await credentials.clear();
      store.patchState({
        savedProfile: null,
      });
      return buildBootstrapState(client, store, null);
    },

    searchGold: async (unsafeQuery: unknown): Promise<MarketSummary[]> => {
      try {
        const query = validateSearchQuery(unsafeQuery);
        return await client.searchGoldMarkets(query);
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    selectMarket: async (unsafeEpic: unknown): Promise<MarketSummary> => {
      try {
        const epic = validateIdentifierString(unsafeEpic, "Select a valid Capital.com market.");
        const market = await client.getMarketDetails(epic);
        store.patchState({
          selectedMarket: market,
        });
        store.appendExecution(
          buildExecutionResult("market", "success", `Selected ${market.instrumentName}.`),
        );
        return market;
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    getSelectedQuote: async () => {
      const selected = store.getState().selectedMarket;

      if (!selected) {
        return null;
      }

      try {
        const quote = await client.getQuote(selected.epic);
        store.patchState({
          selectedMarket: {
            ...selected,
            bid: quote.bid,
            ask: quote.ask,
            marketStatus: quote.marketStatus,
            percentageChange: quote.percentageChange,
            updateTime: quote.updateTime,
          },
        });
        return quote;
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    listPositions: async (): Promise<OpenPosition[]> => {
      try {
        return await client.listPositions();
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    openMarket: async (unsafeInput: unknown): Promise<OpenMarketOrderResponse> => {
      try {
        const input = validateOpenMarketOrderInput(unsafeInput);
        let scheduledJob = null;
        let position = null;
        const resolvedProtection = !input.schedule && input.protection
          ? await resolveProtection(client, {
              epic: input.epic,
              direction: input.direction,
              protection: input.protection,
            })
          : null;

        if (input.schedule) {
          const selectedMarket = store.getState().selectedMarket;
          scheduledJob = scheduler.schedule({
            epic: input.epic,
            instrumentName:
              selectedMarket?.epic === input.epic ? selectedMarket.instrumentName : input.epic,
            direction: input.direction,
            size: input.size,
            protection: input.protection ?? null,
            ...input.schedule,
          });
        } else {
          position = await client.openMarketPosition(input, resolvedProtection);
        }

        const result = buildExecutionResult(
          "order",
          "success",
          input.schedule
            ? `${input.direction} order scheduled for ${input.epic}.`
            : `${input.direction} order placed for ${input.epic}.`,
          input.schedule
            ? scheduledJob?.scheduleType === "repeating"
              ? `Next run ${scheduledJob.runAt}`
              : `Runs at ${scheduledJob?.runAt}`
            : position
              ? `Deal ${position.dealId}`
              : "Awaiting position refresh.",
        );
        store.appendExecution(result);
        return {
          position,
          schedule: scheduledJob,
          result,
        };
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    closePosition: async (unsafeInput: unknown): Promise<ClosePositionResponse> => {
      try {
        const dealId = extractIdentifier(
          unsafeInput,
          "dealId",
          "Choose a valid Capital.com position before closing it.",
        );
        await client.closePosition(dealId);
        const result = buildExecutionResult("close", "success", `Closed position ${dealId}.`);
        store.appendExecution(result);
        return {
          schedules: scheduler.list(),
          result,
        };
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    reversePosition: async (unsafeInput: unknown): Promise<ReversePositionResponse> => {
      try {
        const dealId = extractIdentifier(
          unsafeInput,
          "dealId",
          "Choose a valid Capital.com position before reversing it.",
        );
        const position = await client.reversePosition(dealId);
        const result = buildExecutionResult("order", "success", `Reversed position ${dealId}.`);
        store.appendExecution(result);
        return {
          schedules: scheduler.list(),
          position,
          result,
        };
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    previewProtection,

    updatePositionProtection: async (
      unsafeInput: unknown,
    ): Promise<UpdatePositionProtectionResponse> => {
      try {
        const input = validateUpdatePositionProtectionInput(unsafeInput);
        const resolvedProtection = await resolveProtection(client, {
          epic: input.epic,
          direction: input.direction,
          protection: input.protection,
        });

        if (!resolvedProtection) {
          throw createAppError(
            "MISSING_PROTECTION",
            "Stop loss or take profit must be configured before updating a position.",
          );
        }

        const position = await client.updatePositionProtection(input.dealId, resolvedProtection);
        const result = buildExecutionResult(
          "order",
          "success",
          `Updated protection for position ${input.dealId}.`,
        );
        store.appendExecution(result);
        return {
          position,
          result,
        };
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    listSchedules: async () => scheduler.list(),

    cancelSchedule: async (unsafeInput: unknown): Promise<CancelScheduledOrderResponse> => {
      try {
        const jobId = extractIdentifier(
          unsafeInput,
          "jobId",
          "Choose a valid scheduled order before cancelling it.",
        );
        const schedules = scheduler.cancel(jobId);
        const result = buildExecutionResult("schedule", "info", "Cancelled scheduled order.");
        store.appendExecution(result);
        return {
          schedules,
          result,
        };
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },
  };
}

function buildBootstrapState(
  client: TradingClientLike,
  store: AppStateStore,
  savedProfile: BootstrapState["savedProfile"],
): BootstrapState {
  const persisted = store.getState();

  return {
    connected: client.isConnected(),
    environment: persisted.environment,
    selectedMarket: persisted.selectedMarket,
    schedules: persisted.schedules,
    executionLog: persisted.executionLog,
    savedProfile,
  };
}

function serializeError(error: AppError): Error {
  return new Error(JSON.stringify(error));
}

function validateCapitalCredentials(value: unknown): CapitalCredentials {
  const object = requireObject(value, "Enter valid Capital.com credentials.");
  const identifier = validateIdentifierString(
    object.identifier,
    "Enter your Capital.com account identifier.",
  );
  const password = validateIdentifierString(object.password, "Enter your Capital.com password.");
  const apiKey = validateIdentifierString(object.apiKey, "Enter your Capital.com API key.");
  const environment = object.environment === "live" ? "live" : object.environment === "demo" ? "demo" : null;

  if (!environment) {
    throw createAppError("INVALID_INPUT", "Choose a valid Capital.com environment.", true);
  }

  return {
    identifier,
    password,
    apiKey,
    environment,
  };
}

function validateSearchQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw createAppError("INVALID_INPUT", "Enter a valid market search query.", true);
  }

  return value.trim().slice(0, 120);
}

function validateOpenMarketOrderInput(value: unknown): OpenMarketOrderInput {
  const object = requireObject(value, "Enter a valid market order.");
  const epic = validateIdentifierString(object.epic, "Select a valid market before submitting an order.");
  const direction = validateTradeDirection(object.direction);
  const size = validatePositiveNumber(object.size, "Enter a trade size greater than 0.");

  return {
    epic,
    direction,
    size,
    schedule: validateScheduleRequest(object.schedule),
    protection: validateProtectionStrategy(object.protection, true),
  };
}

function validateProtectionPreviewInput(value: unknown): ProtectionPreviewInput {
  const object = requireObject(value, "Enter a valid protection preview request.");

  return {
    epic: validateIdentifierString(object.epic, "Select a valid market before previewing protection."),
    direction: validateTradeDirection(object.direction),
    protection: validateProtectionStrategy(object.protection, true),
  };
}

function validateUpdatePositionProtectionInput(value: unknown): UpdatePositionProtectionInput {
  const object = requireObject(value, "Enter a valid protection update.");
  const protection = validateProtectionStrategy(object.protection, false);

  if (!protection) {
    throw createAppError(
      "INVALID_INPUT",
      "Stop loss or take profit must be configured before updating a position.",
      true,
    );
  }

  return {
    dealId: validateIdentifierString(object.dealId, "Choose a valid Capital.com position to update."),
    epic: validateIdentifierString(object.epic, "Select a valid market before updating protection."),
    direction: validateTradeDirection(object.direction),
    protection,
  };
}

function validateScheduleRequest(value: unknown): OpenMarketOrderInput["schedule"] {
  if (value === undefined || value === null) {
    return null;
  }

  const object = requireObject(value, "Enter a valid schedule.");

  if (object.type === "one-off") {
    const runAt = validateIdentifierString(object.runAt, "Choose a valid order date and time.");

    if (Number.isNaN(new Date(runAt).getTime())) {
      throw createAppError("INVALID_INPUT", "Choose a valid order date and time.", true);
    }

    return {
      type: "one-off",
      runAt,
    };
  }

  if (object.type === "repeating") {
    if (typeof object.runTime !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(object.runTime)) {
      throw createAppError("INVALID_INPUT", "Choose a valid repeating order time.", true);
    }

    return {
      type: "repeating",
      runTime: object.runTime,
    };
  }

  throw createAppError("INVALID_INPUT", "Choose a valid schedule type.", true);
}

function validateProtectionStrategy(
  value: unknown,
  allowNull: boolean,
): ProtectionStrategy | null {
  if (value === undefined || value === null) {
    if (allowNull) {
      return null;
    }

    throw createAppError("INVALID_INPUT", "Enter a valid protection strategy.", true);
  }

  const object = requireObject(value, "Enter a valid protection strategy.");
  const stopLoss = requireObject(object.stopLoss, "Enter a valid stop-loss strategy.");
  const takeProfit = requireObject(object.takeProfit, "Enter a valid take-profit strategy.");

  return {
    stopLoss: validateStopLoss(stopLoss),
    takeProfit: validateTakeProfit(takeProfit),
  };
}

function validateStopLoss(value: Record<string, unknown>): ProtectionStrategy["stopLoss"] {
  switch (value.mode) {
    case "none":
      return { mode: "none" };
    case "price_level":
      return {
        mode: "price_level",
        level: validatePositiveNumber(value.level, "Enter a valid stop-loss level."),
      };
    case "distance":
      return {
        mode: "distance",
        distance: validatePositiveNumber(value.distance, "Enter a valid stop-loss distance."),
      };
    case "adx_distance":
      return {
        mode: "adx_distance",
        adxMultiplier: validatePositiveNumber(
          value.adxMultiplier,
          "Enter a valid ADX multiplier for the stop loss.",
        ),
      };
    default:
      throw createAppError("INVALID_INPUT", "Choose a valid stop-loss mode.", true);
  }
}

function validateTakeProfit(value: Record<string, unknown>): ProtectionStrategy["takeProfit"] {
  switch (value.mode) {
    case "none":
      return { mode: "none" };
    case "price_level":
      return {
        mode: "price_level",
        level: validatePositiveNumber(value.level, "Enter a valid take-profit level."),
      };
    case "distance":
      return {
        mode: "distance",
        distance: validatePositiveNumber(value.distance, "Enter a valid take-profit distance."),
      };
    case "risk_reward":
      return {
        mode: "risk_reward",
        riskRewardRatio: validatePositiveNumber(
          value.riskRewardRatio,
          "Enter a valid risk/reward ratio for take profit.",
        ),
      };
    case "adx_distance":
      return {
        mode: "adx_distance",
        adxMultiplier: validatePositiveNumber(
          value.adxMultiplier,
          "Enter a valid ADX multiplier for the take profit.",
        ),
      };
    default:
      throw createAppError("INVALID_INPUT", "Choose a valid take-profit mode.", true);
  }
}

function validateTradeDirection(value: unknown): OpenMarketOrderInput["direction"] {
  if (value === "BUY" || value === "SELL") {
    return value;
  }

  throw createAppError("INVALID_INPUT", "Choose a valid trade direction.", true);
}

function validatePositiveNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw createAppError("INVALID_INPUT", message, true);
  }

  return value;
}

function validateIdentifierString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw createAppError("INVALID_INPUT", message, true);
  }

  return value.trim();
}

function extractIdentifier(
  value: unknown,
  key: "dealId" | "jobId",
  message: string,
): string {
  if (typeof value === "string") {
    return validateIdentifierString(value, message);
  }

  const object = requireObject(value, message);
  return validateIdentifierString(object[key], message);
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createAppError("INVALID_INPUT", message, true);
  }

  return value as Record<string, unknown>;
}
