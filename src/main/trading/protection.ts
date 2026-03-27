import type {
  ProtectionStrategy,
  QuoteSnapshot,
  ResolvedProtection,
  TradeDirection,
} from "../../shared/types";

export interface HistoricalPriceBar {
  high: number;
  low: number;
  close: number;
  at: string;
}

export interface ProtectionContextClient {
  getQuote(epic: string): Promise<QuoteSnapshot>;
  getHistoricalPrices(epic: string, resolution: "MINUTE_15", max: number): Promise<HistoricalPriceBar[]>;
}

export async function resolveProtection(
  client: ProtectionContextClient,
  input: {
    epic: string;
    direction: TradeDirection;
    protection: ProtectionStrategy | null | undefined;
  },
): Promise<ResolvedProtection | null> {
  if (!input.protection || isProtectionEmpty(input.protection)) {
    return null;
  }

  const quote = await client.getQuote(input.epic);
  const referencePrice = getReferencePrice(quote, input.direction);
  const needsAdx =
    input.protection.stopLoss.mode === "adx_distance" ||
    input.protection.takeProfit.mode === "adx_distance";
  const adxValue = needsAdx
    ? calculateAdx(await client.getHistoricalPrices(input.epic, "MINUTE_15", 60))
    : null;

  if (needsAdx && adxValue === null) {
    throw new Error("ADX-based protection needs more historical price data.");
  }

  const stop = resolveStopLoss(input.protection.stopLoss, input.direction, referencePrice, adxValue);
  const profit = resolveTakeProfit(
    input.protection.takeProfit,
    input.direction,
    referencePrice,
    stop.stopLevel,
    adxValue,
  );

  assertDirectionalValidity(input.direction, referencePrice, stop.stopLevel, profit.profitLevel);

  return {
    referencePrice,
    stopLevel: stop.stopLevel,
    profitLevel: profit.profitLevel,
    stopDistance: stop.stopDistance,
    profitDistance: profit.profitDistance,
    adxValue,
  };
}

function isProtectionEmpty(protection: ProtectionStrategy): boolean {
  return protection.stopLoss.mode === "none" && protection.takeProfit.mode === "none";
}

function getReferencePrice(quote: QuoteSnapshot, direction: TradeDirection): number {
  const reference = direction === "BUY" ? quote.ask ?? quote.bid : quote.bid ?? quote.ask;

  if (!reference || !Number.isFinite(reference)) {
    throw new Error("A live market quote is required to calculate stop loss and take profit.");
  }

  return reference;
}

function resolveStopLoss(
  stopLoss: ProtectionStrategy["stopLoss"],
  direction: TradeDirection,
  referencePrice: number,
  adxValue: number | null,
): Pick<ResolvedProtection, "stopLevel" | "stopDistance"> {
  switch (stopLoss.mode) {
    case "none":
      return {
        stopLevel: null,
        stopDistance: null,
      };
    case "price_level": {
      const level = requirePositive(stopLoss.level, "Enter a valid stop-loss level.");
      return {
        stopLevel: level,
        stopDistance: Math.abs(referencePrice - level),
      };
    }
    case "distance": {
      const distance = requirePositive(stopLoss.distance, "Enter a valid stop-loss distance.");
      return {
        stopLevel: applyDirectionalDistance(referencePrice, direction, distance, true),
        stopDistance: distance,
      };
    }
    case "adx_distance": {
      const multiplier = requirePositive(
        stopLoss.adxMultiplier,
        "Enter a valid ADX multiplier for the stop loss.",
      );
      const distance = requireAdxDistance(referencePrice, adxValue, multiplier);
      return {
        stopLevel: applyDirectionalDistance(referencePrice, direction, distance, true),
        stopDistance: distance,
      };
    }
  }
}

function resolveTakeProfit(
  takeProfit: ProtectionStrategy["takeProfit"],
  direction: TradeDirection,
  referencePrice: number,
  stopLevel: number | null,
  adxValue: number | null,
): Pick<ResolvedProtection, "profitLevel" | "profitDistance"> {
  switch (takeProfit.mode) {
    case "none":
      return {
        profitLevel: null,
        profitDistance: null,
      };
    case "price_level": {
      const level = requirePositive(takeProfit.level, "Enter a valid take-profit level.");
      return {
        profitLevel: level,
        profitDistance: Math.abs(level - referencePrice),
      };
    }
    case "distance": {
      const distance = requirePositive(takeProfit.distance, "Enter a valid take-profit distance.");
      return {
        profitLevel: applyDirectionalDistance(referencePrice, direction, distance, false),
        profitDistance: distance,
      };
    }
    case "risk_reward": {
      const ratio = requirePositive(
        takeProfit.riskRewardRatio,
        "Enter a valid risk/reward ratio for take profit.",
      );

      if (stopLevel === null) {
        throw new Error("Risk/reward take profit needs a stop loss.");
      }

      const distance = Math.abs(referencePrice - stopLevel) * ratio;
      return {
        profitLevel: applyDirectionalDistance(referencePrice, direction, distance, false),
        profitDistance: distance,
      };
    }
    case "adx_distance": {
      const multiplier = requirePositive(
        takeProfit.adxMultiplier,
        "Enter a valid ADX multiplier for the take profit.",
      );
      const distance = requireAdxDistance(referencePrice, adxValue, multiplier);
      return {
        profitLevel: applyDirectionalDistance(referencePrice, direction, distance, false),
        profitDistance: distance,
      };
    }
  }
}

function requirePositive(value: number | undefined, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(message);
  }

  return value;
}

function requireAdxDistance(referencePrice: number, adxValue: number | null, multiplier: number): number {
  if (adxValue === null || !Number.isFinite(adxValue) || adxValue <= 0) {
    throw new Error("ADX-based protection could not be calculated from the available price history.");
  }

  return (referencePrice * (adxValue / 100)) * multiplier;
}

function applyDirectionalDistance(
  referencePrice: number,
  direction: TradeDirection,
  distance: number,
  inverse: boolean,
): number {
  const multiplier = direction === "BUY" ? 1 : -1;
  const signedDistance = inverse ? -distance : distance;
  return roundPrice(referencePrice + multiplier * signedDistance);
}

function assertDirectionalValidity(
  direction: TradeDirection,
  referencePrice: number,
  stopLevel: number | null,
  profitLevel: number | null,
): void {
  if (direction === "BUY") {
    if (stopLevel !== null && stopLevel >= referencePrice) {
      throw new Error("For BUY orders, the stop loss must be below the market price.");
    }

    if (profitLevel !== null && profitLevel <= referencePrice) {
      throw new Error("For BUY orders, the take profit must be above the market price.");
    }
  } else {
    if (stopLevel !== null && stopLevel <= referencePrice) {
      throw new Error("For SELL orders, the stop loss must be above the market price.");
    }

    if (profitLevel !== null && profitLevel >= referencePrice) {
      throw new Error("For SELL orders, the take profit must be below the market price.");
    }
  }
}

function roundPrice(value: number): number {
  return Number(value.toFixed(6));
}

function calculateAdx(prices: HistoricalPriceBar[], period = 14): number | null {
  if (prices.length < period + 1) {
    return null;
  }

  const trs: number[] = [];
  const plusDms: number[] = [];
  const minusDms: number[] = [];

  for (let index = 1; index < prices.length; index += 1) {
    const current = prices[index];
    const previous = prices[index - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    plusDms.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDms.push(downMove > upMove && downMove > 0 ? downMove : 0);

    trs.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }

  let smoothedTr = sum(trs.slice(0, period));
  let smoothedPlusDm = sum(plusDms.slice(0, period));
  let smoothedMinusDm = sum(minusDms.slice(0, period));
  const dxs: number[] = [];

  for (let index = period; index < trs.length; index += 1) {
    const plusDi = smoothedTr === 0 ? 0 : (smoothedPlusDm / smoothedTr) * 100;
    const minusDi = smoothedTr === 0 ? 0 : (smoothedMinusDm / smoothedTr) * 100;
    const diSum = plusDi + minusDi;
    const dx = diSum === 0 ? 0 : (Math.abs(plusDi - minusDi) / diSum) * 100;
    dxs.push(dx);

    smoothedTr = smoothedTr - smoothedTr / period + trs[index];
    smoothedPlusDm = smoothedPlusDm - smoothedPlusDm / period + plusDms[index];
    smoothedMinusDm = smoothedMinusDm - smoothedMinusDm / period + minusDms[index];
  }

  if (dxs.length === 0) {
    return null;
  }

  return Number((sum(dxs) / dxs.length).toFixed(4));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
