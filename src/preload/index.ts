import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc";
import type {
  AppError,
  CapitalCredentials,
  CapitalDesktopApi,
  OpenMarketOrderInput,
  ProtectionPreviewInput,
  PositionCloseInput,
  PositionReverseInput,
  ScheduledOrderCancelInput,
  UpdatePositionProtectionInput,
} from "../shared/types";

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    throw parseAppError(error);
  }
}

function parseAppError(error: unknown): AppError {
  if (error instanceof Error) {
    try {
      return JSON.parse(error.message) as AppError;
    } catch {
      return {
        code: "UNEXPECTED_ERROR",
        message: error.message,
        recoverable: false,
      };
    }
  }

  return {
    code: "UNEXPECTED_ERROR",
    message: "An unexpected application error occurred.",
    recoverable: false,
  };
}

const api: CapitalDesktopApi = {
  app: {
    bootstrap: () => invoke(IPC_CHANNELS.APP_BOOTSTRAP),
  },
  auth: {
    connect: (credentials: CapitalCredentials) => invoke(IPC_CHANNELS.AUTH_CONNECT, credentials),
    connectSaved: () => invoke(IPC_CHANNELS.AUTH_CONNECT_SAVED),
    disconnect: () => invoke(IPC_CHANNELS.AUTH_DISCONNECT),
    forgetSaved: () => invoke(IPC_CHANNELS.AUTH_FORGET_SAVED),
  },
  markets: {
    searchGold: (query: string) => invoke(IPC_CHANNELS.MARKETS_SEARCH_GOLD, query),
    select: (epic: string) => invoke(IPC_CHANNELS.MARKETS_SELECT, epic),
  },
  quotes: {
    getSelected: () => invoke(IPC_CHANNELS.QUOTES_GET_SELECTED),
  },
  positions: {
    listOpen: () => invoke(IPC_CHANNELS.POSITIONS_LIST_OPEN),
    close: (input: PositionCloseInput) => invoke(IPC_CHANNELS.POSITIONS_CLOSE, input),
    reverse: (input: PositionReverseInput) => invoke(IPC_CHANNELS.POSITIONS_REVERSE, input),
    updateProtection: (input: UpdatePositionProtectionInput) =>
      invoke(IPC_CHANNELS.POSITIONS_UPDATE_PROTECTION, input),
  },
  orders: {
    openMarket: (input: OpenMarketOrderInput) => invoke(IPC_CHANNELS.ORDERS_OPEN_MARKET, input),
    previewProtection: (input: ProtectionPreviewInput) =>
      invoke(IPC_CHANNELS.ORDERS_PREVIEW_PROTECTION, input),
  },
  schedules: {
    list: () => invoke(IPC_CHANNELS.SCHEDULES_LIST),
    cancel: (input: ScheduledOrderCancelInput) => invoke(IPC_CHANNELS.SCHEDULES_CANCEL, input),
  },
};

contextBridge.exposeInMainWorld("capitalApi", api);
