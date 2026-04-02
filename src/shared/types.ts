export type TradingEnvironment = "demo" | "live";
export type TradeDirection = "BUY" | "SELL";
export type ScheduledOrderType = "one-off" | "repeating";
export type StopLossMode = "none" | "price_level" | "distance" | "adx_distance";
export type TakeProfitMode = "none" | "price_level" | "distance" | "risk_reward" | "adx_distance";
export type ScheduledOrderStatus =
  | "scheduled"
  | "executing"
  | "executed"
  | "failed"
  | "missed"
  | "cancelled";

export interface StopLossStrategy {
  mode: StopLossMode;
  level?: number;
  distance?: number;
  adxMultiplier?: number;
}

export interface TakeProfitStrategy {
  mode: TakeProfitMode;
  level?: number;
  distance?: number;
  riskRewardRatio?: number;
  adxMultiplier?: number;
}

export interface ProtectionStrategy {
  stopLoss: StopLossStrategy;
  takeProfit: TakeProfitStrategy;
}

export interface ResolvedProtection {
  referencePrice: number;
  stopLevel: number | null;
  profitLevel: number | null;
  stopDistance: number | null;
  profitDistance: number | null;
  adxValue?: number | null;
}

export interface CapitalCredentials {
  identifier: string;
  password: string;
  apiKey: string;
  environment: TradingEnvironment;
}

export interface SavedProfile {
  identifier: string;
  environment: TradingEnvironment;
}

export interface MarketSummary {
  epic: string;
  instrumentName: string;
  symbol: string;
  instrumentType: string;
  marketStatus: string;
  bid: number | null;
  ask: number | null;
  percentageChange: number | null;
  updateTime: string | null;
}

export interface QuoteSnapshot {
  epic: string;
  instrumentName: string;
  bid: number | null;
  ask: number | null;
  marketStatus: string;
  percentageChange: number | null;
  updateTime: string | null;
}

export interface OpenPosition {
  dealId: string;
  dealReference: string;
  epic: string;
  instrumentName: string;
  direction: TradeDirection;
  size: number;
  level: number;
  currency: string;
  pnl: number;
  bid: number | null;
  ask: number | null;
  createdAt: string;
  stopLevel: number | null;
  profitLevel: number | null;
}

export interface ScheduledOrderJob {
  id: string;
  epic: string;
  instrumentName: string;
  direction: TradeDirection;
  size: number;
  scheduleType: ScheduledOrderType;
  runAt: string;
  runTime?: string;
  status: ScheduledOrderStatus;
  createdAt: string;
  lastAttemptAt?: string;
  lastError?: string;
  reason?: string;
  lastOrderDealId?: string;
  protection?: ProtectionStrategy | null;
  lastResolvedProtection?: ResolvedProtection | null;
}

export interface ExecutionResult {
  action: "auth" | "market" | "order" | "close" | "schedule";
  status: "success" | "error" | "info";
  message: string;
  at: string;
  detail?: string;
}

export interface AppError {
  code: string;
  message: string;
  recoverable: boolean;
  detail?: string;
}

export interface BootstrapState {
  connected: boolean;
  environment: TradingEnvironment;
  selectedMarket: MarketSummary | null;
  schedules: ScheduledOrderJob[];
  executionLog: ExecutionResult[];
  savedProfile: SavedProfile | null;
}

export type ScheduledOrderRequest =
  | {
      type: "one-off";
      runAt: string;
    }
  | {
      type: "repeating";
      runTime: string;
    };

export interface OpenMarketOrderInput {
  epic: string;
  direction: TradeDirection;
  size: number;
  schedule?: ScheduledOrderRequest | null;
  protection?: ProtectionStrategy | null;
}

export interface PositionCloseInput {
  dealId: string;
}

export interface PositionReverseInput {
  dealId: string;
}

export interface ScheduledOrderCancelInput {
  jobId: string;
}

export interface ScheduledOrderUpdateInput {
  jobId: string;
  direction: TradeDirection;
  size: number;
  schedule: ScheduledOrderRequest;
  protection?: ProtectionStrategy | null;
}

export interface ProtectionPreviewInput {
  epic: string;
  direction: TradeDirection;
  protection: ProtectionStrategy | null;
}

export interface UpdatePositionProtectionInput {
  dealId: string;
  epic: string;
  direction: TradeDirection;
  protection: ProtectionStrategy;
}

export interface OpenMarketOrderResponse {
  position: OpenPosition | null;
  schedule: ScheduledOrderJob | null;
  result: ExecutionResult;
}

export interface ClosePositionResponse {
  schedules: ScheduledOrderJob[];
  result: ExecutionResult;
}

export interface ReversePositionResponse {
  schedules: ScheduledOrderJob[];
  position: OpenPosition | null;
  result: ExecutionResult;
}

export interface AuthResponse {
  state: BootstrapState;
  result: ExecutionResult;
}

export interface CancelScheduledOrderResponse {
  schedules: ScheduledOrderJob[];
  result: ExecutionResult;
}

export interface UpdateScheduledOrderResponse {
  schedules: ScheduledOrderJob[];
  result: ExecutionResult;
}

export interface ProtectionPreviewResponse {
  preview: ResolvedProtection | null;
}

export interface UpdatePositionProtectionResponse {
  position: OpenPosition | null;
  result: ExecutionResult;
}

export interface CapitalDesktopApi {
  app: {
    bootstrap: () => Promise<BootstrapState>;
  };
  auth: {
    connect: (credentials: CapitalCredentials) => Promise<AuthResponse>;
    connectSaved: () => Promise<AuthResponse>;
    disconnect: () => Promise<AuthResponse>;
    forgetSaved: () => Promise<BootstrapState>;
  };
  markets: {
    searchGold: (query: string) => Promise<MarketSummary[]>;
    select: (epic: string) => Promise<MarketSummary>;
  };
  quotes: {
    getSelected: () => Promise<QuoteSnapshot | null>;
  };
  positions: {
    listOpen: () => Promise<OpenPosition[]>;
    close: (input: PositionCloseInput) => Promise<ClosePositionResponse>;
    reverse: (input: PositionReverseInput) => Promise<ReversePositionResponse>;
    updateProtection: (input: UpdatePositionProtectionInput) => Promise<UpdatePositionProtectionResponse>;
  };
  orders: {
    openMarket: (input: OpenMarketOrderInput) => Promise<OpenMarketOrderResponse>;
    previewProtection: (input: ProtectionPreviewInput) => Promise<ProtectionPreviewResponse>;
  };
  schedules: {
    list: () => Promise<ScheduledOrderJob[]>;
    cancel: (input: ScheduledOrderCancelInput) => Promise<CancelScheduledOrderResponse>;
    update: (input: ScheduledOrderUpdateInput) => Promise<UpdateScheduledOrderResponse>;
  };
}
