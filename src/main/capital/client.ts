import type {
  AppError,
  CapitalCredentials,
  MarketSummary,
  OpenMarketOrderInput,
  OpenPosition,
  QuoteSnapshot,
  ResolvedProtection,
  TradeDirection,
  TradingEnvironment,
} from "../../shared/types";
import { redactSensitiveText } from "../services/redaction";
import type { HistoricalPriceBar } from "../services/protection";

interface SessionTokens {
  cst: string;
  securityToken: string;
  expiresAt: number;
}

interface DealConfirmation {
  date?: string;
  status?: string;
  dealStatus?: string;
  epic?: string;
  dealReference?: string;
  dealId?: string;
  affectedDeals?: Array<{
    dealId?: string;
    status?: string;
  }>;
  level?: number;
  size?: number;
  direction?: TradeDirection;
  reason?: string;
}

interface MarketsResponse {
  markets?: Array<Record<string, unknown>>;
}

interface PositionsResponse {
  positions?: Array<{
    position?: Record<string, unknown>;
    market?: Record<string, unknown>;
  }>;
}

interface SinglePositionResponse {
  position?: Record<string, unknown>;
  market?: Record<string, unknown>;
}

interface SingleMarketResponse {
  instrument?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
}

interface PricesResponse {
  prices?: Array<{
    snapshotTimeUTC?: string;
    snapshotTime?: string;
    highPrice?: Record<string, unknown>;
    lowPrice?: Record<string, unknown>;
    closePrice?: Record<string, unknown>;
  }>;
}

type FetchLike = typeof fetch;

const BASE_URLS: Record<TradingEnvironment, string> = {
  demo: "https://demo-api-capital.backend-capital.com",
  live: "https://api-capital.backend-capital.com",
};

export class CapitalClient {
  private session: SessionTokens | null = null;
  private credentials: CapitalCredentials | null = null;

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  isConnected(): boolean {
    return Boolean(this.session && this.session.expiresAt > Date.now());
  }

  async connect(credentials: CapitalCredentials): Promise<void> {
    const normalized = {
      ...credentials,
      identifier: credentials.identifier.trim(),
      apiKey: credentials.apiKey.trim(),
    };
    const response = await this.fetchImpl(this.buildUrl(normalized.environment, "/api/v1/session"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CAP-API-KEY": normalized.apiKey,
      },
      body: JSON.stringify({
        identifier: normalized.identifier,
        password: normalized.password,
        encryptedPassword: false,
      }),
    });

    if (!response.ok) {
      throw await this.toAppError(response, "Failed to start a Capital.com session.");
    }

    const cst = response.headers.get("CST");
    const securityToken = response.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      throw createAppError("AUTH_HEADERS_MISSING", "Capital.com did not return session headers.");
    }

    this.credentials = normalized;
    this.session = {
      cst,
      securityToken,
      expiresAt: Date.now() + 9 * 60 * 1000,
    };
  }

  async disconnect(): Promise<void> {
    if (this.session && this.credentials) {
      await this.fetchImpl(this.buildUrl(this.credentials.environment, "/api/v1/session"), {
        method: "DELETE",
        headers: this.buildAuthenticatedHeaders(),
      }).catch(() => undefined);
    }

    this.session = null;
    this.credentials = null;
  }

  async searchGoldMarkets(query: string): Promise<MarketSummary[]> {
    const response = await this.authorizedJson<MarketsResponse>("/api/v1/markets", {
      searchTerm: query.trim() || "gold",
    });
    const rawMarkets = response.markets ?? [];
    const normalizedQuery = (query.trim() || "gold").toLowerCase();

    return rawMarkets
      .map((market) => mapMarketSummary(market))
      .filter((market) => {
        const haystack = `${market.instrumentName} ${market.symbol} ${market.epic}`.toLowerCase();
        return (
          haystack.includes("gold") ||
          haystack.includes("xau") ||
          haystack.includes(normalizedQuery)
        );
      })
      .slice(0, 25);
  }

  async getMarketDetails(epic: string): Promise<MarketSummary> {
    const normalizedEpic = epic.trim();

    try {
      const response = await this.authorizedJson<SingleMarketResponse>(
        `/api/v1/markets/${encodeURIComponent(normalizedEpic)}`,
      );

      if (response.instrument) {
        return mapSingleMarketDetails(response);
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    const exactResponse = await this.authorizedJson<MarketsResponse>("/api/v1/markets", {
      epics: normalizedEpic,
    });
    const exactMarket = (exactResponse.markets ?? [])
      .map((market) => mapMarketSummary(market))
      .find((market) => market.epic.toUpperCase() === normalizedEpic.toUpperCase());

    if (exactMarket) {
      return exactMarket;
    }

    const searchedMarket = (await this.searchGoldMarkets(normalizedEpic)).find(
      (market) => market.epic.toUpperCase() === normalizedEpic.toUpperCase(),
    );

    if (searchedMarket) {
      return searchedMarket;
    }

    throw createAppError("MARKET_NOT_FOUND", `Market ${normalizedEpic} was not found.`, true);
  }

  async getQuote(epic: string): Promise<QuoteSnapshot> {
    const market = await this.getMarketDetails(epic);

    return {
      epic: market.epic,
      instrumentName: market.instrumentName,
      bid: market.bid,
      ask: market.ask,
      marketStatus: market.marketStatus,
      percentageChange: market.percentageChange,
      updateTime: market.updateTime,
    };
  }

  async listPositions(): Promise<OpenPosition[]> {
    const response = await this.authorizedJson<PositionsResponse>("/api/v1/positions");

    return (response.positions ?? []).map(({ position, market }) => mapOpenPosition(position, market));
  }

  async getHistoricalPrices(
    epic: string,
    resolution: "MINUTE_15" = "MINUTE_15",
    max = 60,
  ): Promise<HistoricalPriceBar[]> {
    const response = await this.authorizedJson<PricesResponse>(
      `/api/v1/prices/${encodeURIComponent(epic)}`,
      {
        resolution,
        max: String(max),
      },
    );

    return (response.prices ?? [])
      .map((price) => {
        const high = getPriceMid(price.highPrice);
        const low = getPriceMid(price.lowPrice);
        const close = getPriceMid(price.closePrice);
        const at = stringOrNull(price.snapshotTimeUTC ?? price.snapshotTime);

        if (high === null || low === null || close === null || !at) {
          return null;
        }

        return { high, low, close, at };
      })
      .filter((price): price is HistoricalPriceBar => Boolean(price));
  }

  async openMarketPosition(
    input: OpenMarketOrderInput,
    resolvedProtection?: ResolvedProtection | null,
  ): Promise<OpenPosition | null> {
    const payload = await this.authorizedJson<{ dealReference?: string }>(
      "/api/v1/positions",
      undefined,
      {
        method: "POST",
        body: JSON.stringify({
          epic: input.epic,
          direction: input.direction,
          size: input.size,
          guaranteedStop: false,
          trailingStop: false,
          ...(resolvedProtection?.stopLevel !== null && resolvedProtection?.stopLevel !== undefined
            ? { stopLevel: resolvedProtection.stopLevel }
            : {}),
          ...(resolvedProtection?.profitLevel !== null && resolvedProtection?.profitLevel !== undefined
            ? { profitLevel: resolvedProtection.profitLevel }
            : {}),
        }),
      },
    );
    const dealReference = payload.dealReference;

    if (!dealReference) {
      throw createAppError("ORDER_REFERENCE_MISSING", "Capital.com did not return a deal reference.");
    }

    const confirmation = await this.confirmDeal(dealReference);
    const dealId = confirmation.affectedDeals?.[0]?.dealId ?? confirmation.dealId;

    if (!dealId) {
      return null;
    }

    return this.waitForPosition(dealId);
  }

  async closePosition(dealId: string): Promise<void> {
    const payload = await this.authorizedJson<{ dealReference?: string }>(
      `/api/v1/positions/${dealId}`,
      undefined,
      {
        method: "DELETE",
      },
    );

    if (!payload.dealReference) {
      throw createAppError(
        "CLOSE_REFERENCE_MISSING",
        "Capital.com did not return a close confirmation reference.",
      );
    }

    await this.confirmDeal(payload.dealReference);
  }

  async reversePosition(dealId: string): Promise<OpenPosition | null> {
    const positions = await this.listPositions();
    const current = positions.find((position) => position.dealId === dealId);

    if (!current) {
      throw createAppError("POSITION_NOT_FOUND", `Position ${dealId} was not found.`, true);
    }

    await this.closePosition(dealId);

    return this.openMarketPosition({
      epic: current.epic,
      direction: current.direction === "BUY" ? "SELL" : "BUY",
      size: current.size,
    });
  }

  async updatePositionProtection(
    dealId: string,
    resolvedProtection: ResolvedProtection,
  ): Promise<OpenPosition | null> {
    const payload = await this.authorizedJson<{ dealReference?: string }>(
      `/api/v1/positions/${encodeURIComponent(dealId)}`,
      undefined,
      {
        method: "PUT",
        body: JSON.stringify({
          guaranteedStop: false,
          trailingStop: false,
          ...(resolvedProtection.stopLevel !== null ? { stopLevel: resolvedProtection.stopLevel } : {}),
          ...(resolvedProtection.profitLevel !== null
            ? { profitLevel: resolvedProtection.profitLevel }
            : {}),
        }),
      },
    );

    if (!payload.dealReference) {
      throw createAppError(
        "UPDATE_REFERENCE_MISSING",
        "Capital.com did not return a protection update confirmation reference.",
      );
    }

    await this.confirmDeal(payload.dealReference);
    return this.waitForPosition(dealId);
  }

  private async getPositionByDealId(dealId: string): Promise<OpenPosition> {
    const response = await this.authorizedJson<SinglePositionResponse>(
      `/api/v1/positions/${encodeURIComponent(dealId)}`,
    );

    if (!response.position || !response.market) {
      throw createAppError("POSITION_NOT_FOUND", `Position ${dealId} was not found.`, true);
    }

    return mapOpenPosition(response.position, response.market);
  }

  private async waitForPosition(dealId: string): Promise<OpenPosition | null> {
    let lastError: AppError | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.getPositionByDealId(dealId);
      } catch (error) {
        const normalized = normalizeError(error);

        if (!isNotFoundError(normalized)) {
          throw normalized;
        }

        lastError = normalized;
      }

      await delay(350 * (attempt + 1));
    }

    if (lastError) {
      return null;
    }

    return null;
  }

  private async authorizedJson<T>(
    path: string,
    params?: Record<string, string | undefined>,
    init?: RequestInit,
  ): Promise<T> {
    await this.ensureSession();

    const response = await this.fetchImpl(this.buildUrl(this.credentials!.environment, path, params), {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...this.buildAuthenticatedHeaders(),
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw await this.toAppError(response, "Capital.com request failed.");
    }

    return (await response.json()) as T;
  }

  private async ensureSession(): Promise<void> {
    if (!this.credentials) {
      throw createAppError("NOT_CONNECTED", "Connect to Capital.com before trading.", true);
    }

    if (!this.session || this.session.expiresAt <= Date.now()) {
      await this.connect(this.credentials);
    }
  }

  private buildAuthenticatedHeaders(): HeadersInit {
    if (!this.session) {
      throw createAppError("NOT_CONNECTED", "No Capital.com session is active.", true);
    }

    return {
      CST: this.session.cst,
      "X-SECURITY-TOKEN": this.session.securityToken,
    };
  }

  private buildUrl(
    environment: TradingEnvironment,
    path: string,
    params?: Record<string, string | undefined>,
  ): string {
    const url = new URL(path, BASE_URLS[environment]);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value) {
          url.searchParams.set(key, value);
        }
      });
    }

    return url.toString();
  }

  private async confirmDeal(dealReference: string): Promise<DealConfirmation> {
    let lastError: AppError | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const confirmation = await this.authorizedJson<DealConfirmation>(
          `/api/v1/confirms/${dealReference}`,
        );

        if (confirmation.dealStatus === "REJECTED") {
          throw createAppError(
            "DEAL_REJECTED",
            "Capital.com rejected the deal.",
            true,
            confirmation.reason ?? confirmation.status,
          );
        }

        if (confirmation.dealStatus === "ACCEPTED") {
          return confirmation;
        }

        lastError = createAppError(
          "DEAL_PENDING",
          "Capital.com has not confirmed the trade yet.",
          true,
          confirmation.status,
        );
      } catch (error) {
        lastError = normalizeError(error);
      }

      await delay(350 * (attempt + 1));
    }

    throw lastError ?? createAppError("DEAL_CONFIRM_TIMEOUT", "Timed out waiting for trade confirmation.");
  }

  private async toAppError(response: Response, fallbackMessage: string): Promise<AppError> {
    let detail = response.statusText;

    try {
      const payload = (await response.json()) as { errorCode?: string; message?: string };
      detail = payload.errorCode ?? payload.message ?? detail;
    } catch {
      // No JSON payload returned by the API.
    }

    return createAppError(`CAPITAL_${response.status}`, fallbackMessage, response.status >= 500, detail);
  }
}

function mapMarketSummary(raw: Record<string, unknown>): MarketSummary {
  return {
    epic: stringValue(raw.epic),
    instrumentName: stringValue(raw.instrumentName ?? raw.symbol, "Unknown market"),
    symbol: stringValue(raw.symbol ?? raw.epic),
    instrumentType: stringValue(raw.instrumentType, "UNKNOWN"),
    marketStatus: stringValue(raw.marketStatus, "UNKNOWN"),
    bid: numberOrNull(raw.bid),
    ask: numberOrNull(raw.offer),
    percentageChange: numberOrNull(raw.percentageChange),
    updateTime: stringOrNull(raw.updateTimeUTC ?? raw.updateTime),
  };
}

function mapSingleMarketDetails(raw: SingleMarketResponse): MarketSummary {
  const instrument = raw.instrument ?? {};
  const snapshot = raw.snapshot ?? {};

  return {
    epic: stringValue(instrument.epic),
    instrumentName: stringValue(instrument.name ?? instrument.symbol ?? instrument.epic, "Unknown market"),
    symbol: stringValue(instrument.symbol ?? instrument.epic),
    instrumentType: stringValue(instrument.type, "UNKNOWN"),
    marketStatus: stringValue(snapshot.marketStatus, "UNKNOWN"),
    bid: numberOrNull(snapshot.bid),
    ask: numberOrNull(snapshot.offer),
    percentageChange: numberOrNull(snapshot.percentageChange),
    updateTime: stringOrNull(snapshot.updateTimeUTC ?? snapshot.updateTime),
  };
}

function mapOpenPosition(
  position: Record<string, unknown> | undefined,
  market: Record<string, unknown> | undefined,
): OpenPosition {
  return {
    dealId: String(position?.dealId ?? ""),
    dealReference: String(position?.dealReference ?? ""),
    epic: String(market?.epic ?? ""),
    instrumentName: String(market?.instrumentName ?? "Unknown market"),
    direction: String(position?.direction ?? "BUY") as TradeDirection,
    size: Number(position?.size ?? 0),
    level: Number(position?.level ?? 0),
    currency: String(position?.currency ?? "USD"),
    pnl: Number(position?.upl ?? 0),
    bid: numberOrNull(market?.bid),
    ask: numberOrNull(market?.offer),
    createdAt: String(position?.createdDateUTC ?? position?.createdDate ?? new Date().toISOString()),
    stopLevel: numberOrNull(position?.stopLevel),
    profitLevel: numberOrNull(position?.profitLevel),
  };
}

function getPriceMid(value: Record<string, unknown> | undefined): number | null {
  if (!value) {
    return null;
  }

  const bid = numberOrNull(value.bid);
  const ask = numberOrNull(value.ask);

  if (bid !== null && ask !== null) {
    return Number(((bid + ask) / 2).toFixed(6));
  }

  return bid ?? ask;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return stringOrNull(value) ?? fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createAppError(
  code: string,
  message: string,
  recoverable = true,
  detail?: string,
): AppError {
  return {
    code,
    message: redactSensitiveText(message) ?? message,
    recoverable,
    detail: redactSensitiveText(detail),
  };
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return {
      ...error,
      message: redactSensitiveText(error.message) ?? error.message,
      detail: redactSensitiveText(error.detail),
    };
  }

  if (error instanceof Error) {
    return createAppError("UNEXPECTED_ERROR", error.message, false);
  }

  return createAppError("UNEXPECTED_ERROR", "An unexpected error occurred.", false);
}

function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    "recoverable" in error
  );
}

function isNotFoundError(error: unknown): boolean {
  return isAppError(error) && (error.code === "CAPITAL_404" || error.code === "MARKET_NOT_FOUND");
}
