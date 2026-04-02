import type {
  OpenPosition,
  ProtectionStrategy,
  ResolvedProtection,
  StopLossMode,
  TakeProfitMode,
  TradeDirection,
} from "@shared/types";

export type ProtectionFieldName =
  | "stopLossLevel"
  | "stopLossDistance"
  | "stopLossAdxMultiplier"
  | "takeProfitLevel"
  | "takeProfitDistance"
  | "takeProfitRiskRewardRatio"
  | "takeProfitAdxMultiplier";

export interface ProtectionFormState {
  stopLossMode: StopLossMode;
  stopLossLevel: string;
  stopLossDistance: string;
  stopLossAdxMultiplier: string;
  takeProfitMode: TakeProfitMode;
  takeProfitLevel: string;
  takeProfitDistance: string;
  takeProfitRiskRewardRatio: string;
  takeProfitAdxMultiplier: string;
}

export interface ProtectionFormValidationResult {
  fieldErrors: Partial<Record<ProtectionFieldName, string>>;
  firstInvalidField?: ProtectionFieldName;
  strategy: ProtectionStrategy | null;
}

export const EMPTY_PROTECTION_FORM: ProtectionFormState = {
  stopLossMode: "none",
  stopLossLevel: "",
  stopLossDistance: "",
  stopLossAdxMultiplier: "",
  takeProfitMode: "none",
  takeProfitLevel: "",
  takeProfitDistance: "",
  takeProfitRiskRewardRatio: "",
  takeProfitAdxMultiplier: "",
};

export function validateProtectionForm(
  input: ProtectionFormState,
  direction: TradeDirection,
  referencePrice?: number | null,
): ProtectionFormValidationResult {
  const fieldErrors: ProtectionFormValidationResult["fieldErrors"] = {};

  const stopLoss = buildStopLoss(input, fieldErrors);
  const takeProfit = buildTakeProfit(input, fieldErrors, stopLoss.mode !== "none");

  if (referencePrice && Number.isFinite(referencePrice)) {
    if (stopLoss.mode === "price_level" && stopLoss.level !== undefined) {
      if (direction === "BUY" && stopLoss.level >= referencePrice) {
        fieldErrors.stopLossLevel = "For BUY orders, stop loss must be below the market price.";
      }

      if (direction === "SELL" && stopLoss.level <= referencePrice) {
        fieldErrors.stopLossLevel = "For SELL orders, stop loss must be above the market price.";
      }
    }

    if (takeProfit.mode === "price_level" && takeProfit.level !== undefined) {
      if (direction === "BUY" && takeProfit.level <= referencePrice) {
        fieldErrors.takeProfitLevel = "For BUY orders, take profit must be above the market price.";
      }

      if (direction === "SELL" && takeProfit.level >= referencePrice) {
        fieldErrors.takeProfitLevel = "For SELL orders, take profit must be below the market price.";
      }
    }
  }

  return {
    fieldErrors,
    firstInvalidField: getFirstInvalidField(fieldErrors, [
      "stopLossLevel",
      "stopLossDistance",
      "stopLossAdxMultiplier",
      "takeProfitLevel",
      "takeProfitDistance",
      "takeProfitRiskRewardRatio",
      "takeProfitAdxMultiplier",
    ]),
    strategy:
      Object.keys(fieldErrors).length === 0
        ? {
            stopLoss,
            takeProfit,
          }
        : null,
  };
}

export function createProtectionFormFromPosition(position: OpenPosition): ProtectionFormState {
  return {
    ...EMPTY_PROTECTION_FORM,
    stopLossMode: position.stopLevel ? "price_level" : "none",
    stopLossLevel: position.stopLevel ? String(position.stopLevel) : "",
    takeProfitMode: position.profitLevel ? "price_level" : "none",
    takeProfitLevel: position.profitLevel ? String(position.profitLevel) : "",
  };
}

export function createProtectionFormFromStrategy(
  strategy: ProtectionStrategy | null | undefined,
): ProtectionFormState {
  if (!strategy) {
    return { ...EMPTY_PROTECTION_FORM };
  }

  return {
    stopLossMode: strategy.stopLoss.mode,
    stopLossLevel: strategy.stopLoss.level !== undefined ? String(strategy.stopLoss.level) : "",
    stopLossDistance:
      strategy.stopLoss.distance !== undefined ? String(strategy.stopLoss.distance) : "",
    stopLossAdxMultiplier:
      strategy.stopLoss.adxMultiplier !== undefined ? String(strategy.stopLoss.adxMultiplier) : "",
    takeProfitMode: strategy.takeProfit.mode,
    takeProfitLevel: strategy.takeProfit.level !== undefined ? String(strategy.takeProfit.level) : "",
    takeProfitDistance:
      strategy.takeProfit.distance !== undefined ? String(strategy.takeProfit.distance) : "",
    takeProfitRiskRewardRatio:
      strategy.takeProfit.riskRewardRatio !== undefined
        ? String(strategy.takeProfit.riskRewardRatio)
        : "",
    takeProfitAdxMultiplier:
      strategy.takeProfit.adxMultiplier !== undefined
        ? String(strategy.takeProfit.adxMultiplier)
        : "",
  };
}

export function hasProtectionStrategy(strategy: ProtectionStrategy | null | undefined): boolean {
  return Boolean(
    strategy && (strategy.stopLoss.mode !== "none" || strategy.takeProfit.mode !== "none"),
  );
}

export function formatResolvedProtection(preview: ResolvedProtection | null): string {
  if (!preview) {
    return "No stop loss or take profit configured.";
  }

  const parts = [
    `Ref ${formatNumber(preview.referencePrice)}`,
    preview.stopLevel !== null ? `SL ${formatNumber(preview.stopLevel)}` : null,
    preview.profitLevel !== null ? `TP ${formatNumber(preview.profitLevel)}` : null,
    preview.adxValue ? `ADX ${preview.adxValue.toFixed(2)}` : null,
  ].filter(Boolean);

  return parts.join(" • ");
}

function buildStopLoss(
  input: ProtectionFormState,
  errors: Partial<Record<ProtectionFieldName, string>>,
): ProtectionStrategy["stopLoss"] {
  switch (input.stopLossMode) {
    case "none":
      return { mode: "none" };
    case "price_level":
      return {
        mode: "price_level",
        level: parseRequiredNumber(input.stopLossLevel, "stopLossLevel", errors, "Enter a stop-loss level."),
      };
    case "distance":
      return {
        mode: "distance",
        distance: parseRequiredNumber(
          input.stopLossDistance,
          "stopLossDistance",
          errors,
          "Enter a stop-loss distance.",
        ),
      };
    case "adx_distance":
      return {
        mode: "adx_distance",
        adxMultiplier: parseRequiredNumber(
          input.stopLossAdxMultiplier,
          "stopLossAdxMultiplier",
          errors,
          "Enter an ADX multiplier for the stop loss.",
        ),
      };
  }
}

function buildTakeProfit(
  input: ProtectionFormState,
  errors: Partial<Record<ProtectionFieldName, string>>,
  hasStopLoss: boolean,
): ProtectionStrategy["takeProfit"] {
  switch (input.takeProfitMode) {
    case "none":
      return { mode: "none" };
    case "price_level":
      return {
        mode: "price_level",
        level: parseRequiredNumber(
          input.takeProfitLevel,
          "takeProfitLevel",
          errors,
          "Enter a take-profit level.",
        ),
      };
    case "distance":
      return {
        mode: "distance",
        distance: parseRequiredNumber(
          input.takeProfitDistance,
          "takeProfitDistance",
          errors,
          "Enter a take-profit distance.",
        ),
      };
    case "risk_reward": {
      if (!hasStopLoss) {
        errors.takeProfitRiskRewardRatio = "Risk/reward take profit needs a stop loss.";
      }

      return {
        mode: "risk_reward",
        riskRewardRatio: parseRequiredNumber(
          input.takeProfitRiskRewardRatio,
          "takeProfitRiskRewardRatio",
          errors,
          "Enter a risk/reward ratio.",
        ),
      };
    }
    case "adx_distance":
      return {
        mode: "adx_distance",
        adxMultiplier: parseRequiredNumber(
          input.takeProfitAdxMultiplier,
          "takeProfitAdxMultiplier",
          errors,
          "Enter an ADX multiplier for the take profit.",
        ),
      };
  }
}

function parseRequiredNumber(
  value: string,
  field: ProtectionFieldName,
  errors: Partial<Record<ProtectionFieldName, string>>,
  message: string,
): number | undefined {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors[field] = message;
    return undefined;
  }

  return parsed;
}

function getFirstInvalidField<TFieldName extends string>(
  fieldErrors: Partial<Record<TFieldName, string>>,
  order: TFieldName[],
): TFieldName | undefined {
  return order.find((field) => Boolean(fieldErrors[field]));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(value);
}
