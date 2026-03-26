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
  ProtectionPreviewInput,
  ProtectionPreviewResponse,
  QuoteSnapshot,
  ReversePositionResponse,
  ScheduledOrderJob,
  UpdatePositionProtectionInput,
  UpdatePositionProtectionResponse,
} from "../shared/types";
import { createAppError, normalizeError } from "./capital/client";
import { buildExecutionResult, type AppStateStore } from "./services/app-store";
import type { CredentialStore } from "./services/credential-store";
import { resolveProtection } from "./services/protection";
import type { ScheduledOrderInput } from "./services/scheduler";

export interface TradingClientLike {
  connect(credentials: CapitalCredentials): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  searchGoldMarkets(query: string): Promise<MarketSummary[]>;
  getMarketDetails(epic: string): Promise<MarketSummary>;
  getQuote(epic: string): Promise<QuoteSnapshot>;
  getHistoricalPrices(epic: string, resolution: "MINUTE_15", max: number): Promise<import("./services/protection").HistoricalPriceBar[]>;
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
  ipcMain.handle(IPC_CHANNELS.POSITIONS_CLOSE, (_event, input: { dealId: string }) =>
    handlers.closePosition(input.dealId),
  );
  ipcMain.handle(IPC_CHANNELS.POSITIONS_REVERSE, (_event, input: { dealId: string }) =>
    handlers.reversePosition(input.dealId),
  );
  ipcMain.handle(
    IPC_CHANNELS.POSITIONS_UPDATE_PROTECTION,
    (_event, input: UpdatePositionProtectionInput) => handlers.updatePositionProtection(input),
  );
  ipcMain.handle(IPC_CHANNELS.SCHEDULES_LIST, handlers.listSchedules);
  ipcMain.handle(IPC_CHANNELS.SCHEDULES_CANCEL, (_event, input: { jobId: string }) =>
    handlers.cancelSchedule(input.jobId),
  );
}

export function createIpcHandlers({ client, store, credentials, scheduler }: IpcDependencies) {
  const previewProtection = async (
    input: ProtectionPreviewInput,
  ): Promise<ProtectionPreviewResponse> => {
    try {
      return {
        preview: await resolveProtection(client, input),
      };
    } catch (error) {
      throw serializeError(normalizeError(error));
    }
  };

  const connect = async (input: CapitalCredentials): Promise<AuthResponse> => {
    try {
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

    searchGold: async (query: string): Promise<MarketSummary[]> => {
      try {
        return await client.searchGoldMarkets(query);
      } catch (error) {
        throw serializeError(normalizeError(error));
      }
    },

    selectMarket: async (epic: string): Promise<MarketSummary> => {
      try {
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

    openMarket: async (input: OpenMarketOrderInput): Promise<OpenMarketOrderResponse> => {
      try {
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

    closePosition: async (dealId: string): Promise<ClosePositionResponse> => {
      try {
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

    reversePosition: async (dealId: string): Promise<ReversePositionResponse> => {
      try {
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
      input: UpdatePositionProtectionInput,
    ): Promise<UpdatePositionProtectionResponse> => {
      try {
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

    cancelSchedule: async (jobId: string): Promise<CancelScheduledOrderResponse> => {
      const schedules = scheduler.cancel(jobId);
      const result = buildExecutionResult("schedule", "info", "Cancelled scheduled order.");
      store.appendExecution(result);
      return {
        schedules,
        result,
      };
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
