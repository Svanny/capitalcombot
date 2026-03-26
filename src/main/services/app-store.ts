import { createRequire } from "node:module";
import type {
  ExecutionResult,
  MarketSummary,
  SavedProfile,
  ScheduledOrderJob,
  TradingEnvironment,
} from "../../shared/types";
import { redactSensitiveText } from "./redaction";

export interface PersistedAppState {
  environment: TradingEnvironment;
  selectedMarket: MarketSummary | null;
  schedules: ScheduledOrderJob[];
  executionLog: ExecutionResult[];
  savedProfile: SavedProfile | null;
}

const DEFAULT_STATE: PersistedAppState = {
  environment: "demo",
  selectedMarket: null,
  schedules: [],
  executionLog: [],
  savedProfile: null,
};

const MAX_EXECUTION_LOG = 40;

export interface AppStateStore {
  getState(): PersistedAppState;
  patchState(partial: Partial<PersistedAppState>): void;
  setSchedules(schedules: ScheduledOrderJob[]): void;
  appendExecution(result: ExecutionResult): void;
}

export class ElectronAppStateStore implements AppStateStore {
  private readonly store: {
    store: PersistedAppState;
    set(key: keyof PersistedAppState, value: PersistedAppState[keyof PersistedAppState]): void;
  };

  constructor() {
    const require = createRequire(import.meta.url);
    const electronStoreModule = require("electron-store") as {
      default?: {
        new (options: {
          name: string;
          clearInvalidConfig: boolean;
          defaults: PersistedAppState;
        }): {
          store: PersistedAppState;
          set(
            key: keyof PersistedAppState,
            value: PersistedAppState[keyof PersistedAppState],
          ): void;
        };
      };
      new (options: {
        name: string;
        clearInvalidConfig: boolean;
        defaults: PersistedAppState;
      }): {
        store: PersistedAppState;
        set(
          key: keyof PersistedAppState,
          value: PersistedAppState[keyof PersistedAppState],
        ): void;
      };
    };
    const ElectronStore = electronStoreModule.default ?? electronStoreModule;

    this.store = new ElectronStore({
      name: "capitalcombot",
      clearInvalidConfig: true,
      defaults: DEFAULT_STATE,
    });
  }

  getState(): PersistedAppState {
    return normalizePersistedState({
      ...DEFAULT_STATE,
      ...this.store.store,
    });
  }

  patchState(partial: Partial<PersistedAppState>): void {
    Object.entries(partial).forEach(([key, value]) => {
      if (value !== undefined) {
        this.store.set(key as keyof PersistedAppState, value as PersistedAppState[keyof PersistedAppState]);
      }
    });
  }

  setSchedules(schedules: ScheduledOrderJob[]): void {
    this.store.set("schedules", schedules);
  }

  appendExecution(result: ExecutionResult): void {
    const current = this.getState().executionLog;
    this.store.set("executionLog", [sanitizeExecutionResult(result), ...current].slice(0, MAX_EXECUTION_LOG));
  }
}

export class MemoryAppStateStore implements AppStateStore {
  private state: PersistedAppState = structuredClone(DEFAULT_STATE);

  getState(): PersistedAppState {
    return normalizePersistedState(structuredClone(this.state));
  }

  patchState(partial: Partial<PersistedAppState>): void {
    this.state = {
      ...this.state,
      ...structuredClone(partial),
    };
  }

  setSchedules(schedules: ScheduledOrderJob[]): void {
    this.state.schedules = structuredClone(schedules);
  }

  appendExecution(result: ExecutionResult): void {
    this.state.executionLog = [sanitizeExecutionResult(result), ...this.state.executionLog].slice(
      0,
      MAX_EXECUTION_LOG,
    );
  }
}

export function buildExecutionResult(
  action: ExecutionResult["action"],
  status: ExecutionResult["status"],
  message: string,
  detail?: string,
): ExecutionResult {
  return {
    action,
    status,
    message: redactSensitiveText(message) ?? message,
    detail: redactSensitiveText(detail),
    at: new Date().toISOString(),
  };
}

function sanitizeExecutionResult(result: ExecutionResult): ExecutionResult {
  return {
    ...result,
    message: redactSensitiveText(result.message) ?? result.message,
    detail: redactSensitiveText(result.detail),
  };
}

function normalizePersistedState(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    schedules: state.schedules.filter(isValidScheduledOrderJob),
  };
}

function isValidScheduledOrderJob(value: ScheduledOrderJob): boolean {
  return (
    typeof value?.id === "string" &&
    typeof value.epic === "string" &&
    typeof value.instrumentName === "string" &&
    (value.direction === "BUY" || value.direction === "SELL") &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size > 0 &&
    (value.scheduleType === "one-off" || value.scheduleType === "repeating") &&
    typeof value.runAt === "string" &&
    !Number.isNaN(new Date(value.runAt).getTime()) &&
    ["scheduled", "executing", "executed", "failed", "missed", "cancelled"].includes(value.status)
  );
}
