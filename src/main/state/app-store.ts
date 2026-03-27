import { createRequire } from "node:module";
import type {
  ExecutionResult,
  MarketSummary,
  ProtectionStrategy,
  ResolvedProtection,
  SavedProfile,
  ScheduledOrderJob,
  TradingEnvironment,
} from "../../shared/types";
import { redactSensitiveText } from "../security/redaction";
import {
  createStateIntegrityProtector,
  type StateIntegrityProtector,
} from "../security/state-integrity";

export interface PersistedAppState {
  environment: TradingEnvironment;
  selectedMarket: MarketSummary | null;
  schedules: ScheduledOrderJob[];
  executionLog: ExecutionResult[];
  savedProfile: SavedProfile | null;
}

interface StoredEnvelope {
  version: 1;
  state: PersistedAppState;
  signature: string;
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

export interface AppStateStoreBootstrap {
  backend: "signed-electron-store" | "memory";
  store: AppStateStore;
  warning?: string;
}

export async function createAppStateStore(options?: {
  fallback?: AppStateStore;
}): Promise<AppStateStoreBootstrap> {
  const fallback = options?.fallback ?? new MemoryAppStateStore();
  const integrity = await createStateIntegrityProtector();

  if (integrity.backend === "memory") {
    return {
      backend: "memory",
      store: fallback,
      warning: integrity.warning,
    };
  }

  return {
    backend: "signed-electron-store",
    store: new ElectronAppStateStore(integrity.protector),
  };
}

export class ElectronAppStateStore implements AppStateStore {
  private readonly store: {
    store: Record<string, unknown>;
    set(key: string, value: unknown): void;
  };

  constructor(
    private readonly integrity: StateIntegrityProtector,
    storeOverride?: {
      store: Record<string, unknown>;
      set(key: string, value: unknown): void;
    },
  ) {
    if (storeOverride) {
      this.store = storeOverride;
      return;
    }

    const require = createRequire(import.meta.url);
    const electronStoreModule = require("electron-store") as {
      default?: {
        new (options: {
          name: string;
          clearInvalidConfig: boolean;
        }): {
          store: Record<string, unknown>;
          set(key: string, value: unknown): void;
        };
      };
      new (options: {
        name: string;
        clearInvalidConfig: boolean;
      }): {
        store: Record<string, unknown>;
        set(key: string, value: unknown): void;
      };
    };
    const ElectronStore = electronStoreModule.default ?? electronStoreModule;

    this.store = new ElectronStore({
      name: "capitalcombot",
      clearInvalidConfig: true,
    });
  }

  getState(): PersistedAppState {
    return this.readEnvelope().state;
  }

  patchState(partial: Partial<PersistedAppState>): void {
    const current = this.getState();
    const nextState = normalizePersistedState({
      ...current,
      ...structuredClone(partial),
    });

    this.writeEnvelope(nextState);
  }

  setSchedules(schedules: ScheduledOrderJob[]): void {
    const current = this.getState();
    this.writeEnvelope({
      ...current,
      schedules: normalizePersistedState({
        ...current,
        schedules: structuredClone(schedules),
      }).schedules,
    });
  }

  appendExecution(result: ExecutionResult): void {
    const current = this.getState().executionLog;
    this.writeEnvelope({
      ...this.getState(),
      executionLog: [sanitizeExecutionResult(result), ...current].slice(0, MAX_EXECUTION_LOG),
    });
  }

  private readEnvelope(): StoredEnvelope {
    const rawStore = this.store.store;
    const candidate = parseStoredEnvelope(rawStore);

    if (candidate && this.integrity.verify(candidate.state, candidate.signature)) {
      return {
        ...candidate,
        state: normalizePersistedState(candidate.state),
      };
    }

    const migrated = parseLegacyState(rawStore);

    if (migrated) {
      const sanitized = {
        ...migrated,
        schedules: [],
        executionLog: [],
      };
      const envelope = this.buildEnvelope(sanitized);
      this.commitEnvelope(envelope);
      return envelope;
    }

    const defaults = this.buildEnvelope(DEFAULT_STATE);
    this.commitEnvelope(defaults);
    return defaults;
  }

  private writeEnvelope(state: PersistedAppState): void {
    this.commitEnvelope(this.buildEnvelope(state));
  }

  private buildEnvelope(state: PersistedAppState): StoredEnvelope {
    const normalized = normalizePersistedState(state);

    return {
      version: 1,
      state: normalized,
      signature: this.integrity.sign(normalized),
    };
  }

  private commitEnvelope(envelope: StoredEnvelope): void {
    this.store.set("version", envelope.version);
    this.store.set("state", envelope.state);
    this.store.set("signature", envelope.signature);
  }
}

export class MemoryAppStateStore implements AppStateStore {
  private state: PersistedAppState = structuredClone(DEFAULT_STATE);

  getState(): PersistedAppState {
    return normalizePersistedState(structuredClone(this.state));
  }

  patchState(partial: Partial<PersistedAppState>): void {
    this.state = normalizePersistedState({
      ...this.state,
      ...structuredClone(partial),
    });
  }

  setSchedules(schedules: ScheduledOrderJob[]): void {
    this.state.schedules = normalizePersistedState({
      ...this.state,
      schedules: structuredClone(schedules),
    }).schedules;
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

function parseStoredEnvelope(value: Record<string, unknown>): StoredEnvelope | null {
  if (value.version !== 1 || typeof value.signature !== "string" || !isRecord(value.state)) {
    return null;
  }

  return {
    version: 1,
    signature: value.signature,
    state: parsePersistedState(value.state),
  };
}

function parseLegacyState(value: Record<string, unknown>): PersistedAppState | null {
  if (!("environment" in value) && !("selectedMarket" in value) && !("savedProfile" in value)) {
    return null;
  }

  return parsePersistedState(value);
}

function parsePersistedState(value: Record<string, unknown>): PersistedAppState {
  return normalizePersistedState({
    environment: parseTradingEnvironment(value.environment),
    selectedMarket: parseMarketSummary(value.selectedMarket),
    schedules: parseSchedules(value.schedules),
    executionLog: parseExecutionLog(value.executionLog),
    savedProfile: parseSavedProfile(value.savedProfile),
  });
}

function normalizePersistedState(state: PersistedAppState): PersistedAppState {
  return {
    environment: parseTradingEnvironment(state.environment),
    selectedMarket: parseMarketSummary(state.selectedMarket),
    schedules: parseSchedules(state.schedules),
    executionLog: parseExecutionLog(state.executionLog).slice(0, MAX_EXECUTION_LOG),
    savedProfile: parseSavedProfile(state.savedProfile),
  };
}

function parseTradingEnvironment(value: unknown): TradingEnvironment {
  return value === "live" ? "live" : "demo";
}

function parseMarketSummary(value: unknown): MarketSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const epic = parseNonEmptyString(value.epic);
  const instrumentName = parseNonEmptyString(value.instrumentName);
  const symbol = parseNonEmptyString(value.symbol);
  const instrumentType = parseNonEmptyString(value.instrumentType);
  const marketStatus = parseNonEmptyString(value.marketStatus);

  if (!epic || !instrumentName || !symbol || !instrumentType || !marketStatus) {
    return null;
  }

  return {
    epic,
    instrumentName,
    symbol,
    instrumentType,
    marketStatus,
    bid: parseNullableFiniteNumber(value.bid),
    ask: parseNullableFiniteNumber(value.ask),
    percentageChange: parseNullableFiniteNumber(value.percentageChange),
    updateTime: parseNullableIsoString(value.updateTime),
  };
}

function parseSchedules(value: unknown): ScheduledOrderJob[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => parseScheduledOrderJob(entry))
    .filter((entry): entry is ScheduledOrderJob => entry !== null);
}

function parseScheduledOrderJob(value: unknown): ScheduledOrderJob | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = parseNonEmptyString(value.id);
  const epic = parseNonEmptyString(value.epic);
  const instrumentName = parseNonEmptyString(value.instrumentName);
  const direction = value.direction === "BUY" || value.direction === "SELL" ? value.direction : null;
  const size = parsePositiveNumber(value.size);
  const scheduleType = value.scheduleType === "one-off" || value.scheduleType === "repeating"
    ? value.scheduleType
    : null;
  const runAt = parseRequiredIsoString(value.runAt);
  const status = parseScheduledStatus(value.status);
  const createdAt = parseRequiredIsoString(value.createdAt);

  if (!id || !epic || !instrumentName || !direction || !size || !scheduleType || !runAt || !status || !createdAt) {
    return null;
  }

  const runTime = scheduleType === "repeating" ? parseRunTime(value.runTime) : undefined;
  const protection = parseProtectionStrategy(value.protection);

  if (scheduleType === "repeating" && !runTime) {
    return null;
  }

  if (value.protection !== undefined && value.protection !== null && !protection) {
    return null;
  }

  return {
    id,
    epic,
    instrumentName,
    direction,
    size,
    scheduleType,
    runAt,
    runTime: runTime ?? undefined,
    status,
    createdAt,
    lastAttemptAt: parseNullableIsoString(value.lastAttemptAt) ?? undefined,
    lastError: parseOptionalString(value.lastError),
    reason: parseOptionalString(value.reason),
    lastOrderDealId: parseOptionalString(value.lastOrderDealId),
    protection,
    lastResolvedProtection: parseResolvedProtection(value.lastResolvedProtection),
  };
}

function parseScheduledStatus(value: unknown): ScheduledOrderJob["status"] | null {
  return ["scheduled", "executing", "executed", "failed", "missed", "cancelled"].includes(String(value))
    ? (value as ScheduledOrderJob["status"])
    : null;
}

function parseProtectionStrategy(value: unknown): ProtectionStrategy | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value) || !isRecord(value.stopLoss) || !isRecord(value.takeProfit)) {
    return null;
  }

  const stopLoss = parseStopLossStrategy(value.stopLoss);
  const takeProfit = parseTakeProfitStrategy(value.takeProfit);

  if (!stopLoss || !takeProfit) {
    return null;
  }

  return {
    stopLoss,
    takeProfit,
  };
}

function parseStopLossStrategy(value: Record<string, unknown>): ProtectionStrategy["stopLoss"] | null {
  switch (value.mode) {
    case "none":
      return { mode: "none" };
    case "price_level": {
      const level = parsePositiveNumber(value.level);
      return level ? { mode: "price_level", level } : null;
    }
    case "distance": {
      const distance = parsePositiveNumber(value.distance);
      return distance ? { mode: "distance", distance } : null;
    }
    case "adx_distance": {
      const adxMultiplier = parsePositiveNumber(value.adxMultiplier);
      return adxMultiplier ? { mode: "adx_distance", adxMultiplier } : null;
    }
    default:
      return null;
  }
}

function parseTakeProfitStrategy(value: Record<string, unknown>): ProtectionStrategy["takeProfit"] | null {
  switch (value.mode) {
    case "none":
      return { mode: "none" };
    case "price_level": {
      const level = parsePositiveNumber(value.level);
      return level ? { mode: "price_level", level } : null;
    }
    case "distance": {
      const distance = parsePositiveNumber(value.distance);
      return distance ? { mode: "distance", distance } : null;
    }
    case "risk_reward": {
      const riskRewardRatio = parsePositiveNumber(value.riskRewardRatio);
      return riskRewardRatio ? { mode: "risk_reward", riskRewardRatio } : null;
    }
    case "adx_distance": {
      const adxMultiplier = parsePositiveNumber(value.adxMultiplier);
      return adxMultiplier ? { mode: "adx_distance", adxMultiplier } : null;
    }
    default:
      return null;
  }
}

function parseResolvedProtection(value: unknown): ResolvedProtection | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const referencePrice = parsePositiveNumber(value.referencePrice);

  if (!referencePrice) {
    return null;
  }

  return {
    referencePrice,
    stopLevel: parseNullableFiniteNumber(value.stopLevel),
    profitLevel: parseNullableFiniteNumber(value.profitLevel),
    stopDistance: parseNullableFiniteNumber(value.stopDistance),
    profitDistance: parseNullableFiniteNumber(value.profitDistance),
    adxValue: parseNullableFiniteNumber(value.adxValue),
  };
}

function parseExecutionLog(value: unknown): ExecutionResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => parseExecutionResult(entry))
    .filter((entry): entry is ExecutionResult => entry !== null);
}

function parseExecutionResult(value: unknown): ExecutionResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = ["auth", "market", "order", "close", "schedule"].includes(String(value.action))
    ? (value.action as ExecutionResult["action"])
    : null;
  const status = ["success", "error", "info"].includes(String(value.status))
    ? (value.status as ExecutionResult["status"])
    : null;
  const message = parseNonEmptyString(value.message);
  const at = parseRequiredIsoString(value.at);

  if (!action || !status || !message || !at) {
    return null;
  }

  return {
    action,
    status,
    message: redactSensitiveText(message) ?? message,
    at,
    detail: redactSensitiveText(parseOptionalString(value.detail)),
  };
}

function parseSavedProfile(value: unknown): SavedProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const identifier = parseNonEmptyString(value.identifier);
  const environment = parseTradingEnvironment(value.environment);

  if (!identifier) {
    return null;
  }

  return {
    identifier,
    environment,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function parseNullableFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRequiredIsoString(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function parseNullableIsoString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return parseRequiredIsoString(value);
}

function parseRunTime(value: unknown): string | null {
  return typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value) ? value : null;
}
