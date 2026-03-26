import type { AppError, ScheduledOrderRequest, ScheduledOrderType } from "@shared/types";

export type AuthFieldName = "identifier" | "password" | "apiKey";
export type OrderFieldName = "size" | "scheduleAt" | "selectedMarketEpic";

export interface AuthFormInput {
  identifier: string;
  password: string;
  apiKey: string;
}

export interface AuthValidationResult {
  fieldErrors: Partial<Record<AuthFieldName, string>>;
  firstInvalidField?: AuthFieldName;
}

export interface OrderFormInput {
  size: string;
  runAt: string;
  runTime: string;
  scheduleType: ScheduledOrderType;
  wantsScheduledClose: boolean;
  selectedMarketEpic: string | null;
}

export interface OrderValidationResult {
  fieldErrors: Partial<Record<OrderFieldName, string>>;
  firstInvalidField?: OrderFieldName;
  normalizedSize?: number;
  schedule?: ScheduledOrderRequest;
}

export function validateAuthForm(input: AuthFormInput): AuthValidationResult {
  const fieldErrors: AuthValidationResult["fieldErrors"] = {};

  if (!input.identifier.trim()) {
    fieldErrors.identifier = "Enter your Capital.com account identifier.";
  }

  if (!input.password.trim()) {
    fieldErrors.password = "Enter your Capital.com password.";
  }

  if (!input.apiKey.trim()) {
    fieldErrors.apiKey = "Enter your Capital.com API key.";
  }

  return {
    fieldErrors,
    firstInvalidField: getFirstInvalidField(fieldErrors, [
      "identifier",
      "password",
      "apiKey",
    ]),
  };
}

export function validateOrderForm(input: OrderFormInput): OrderValidationResult {
  const fieldErrors: OrderValidationResult["fieldErrors"] = {};
  const normalizedSize = Number(input.size);

  if (!input.selectedMarketEpic) {
    fieldErrors.selectedMarketEpic = "Select a Gold market before submitting an order.";
  }

  if (!Number.isFinite(normalizedSize) || normalizedSize <= 0) {
    fieldErrors.size = "Enter a trade size greater than 0.";
  }

  let schedule: ScheduledOrderRequest | undefined;
  if (input.wantsScheduledClose) {
    if (input.scheduleType === "one-off") {
      const parsedRunAt = parseLocalDateTime(input.runAt);

      if (!parsedRunAt) {
        fieldErrors.scheduleAt = "Choose a valid order date and time.";
      } else if (parsedRunAt.getTime() <= Date.now()) {
        fieldErrors.scheduleAt = "Choose an order date and time in the future.";
      } else {
        schedule = {
          type: "one-off",
          runAt: parsedRunAt.toISOString(),
        };
      }
    } else if (!parseLocalTime(input.runTime)) {
      fieldErrors.scheduleAt = "Choose a valid repeating order time.";
    } else {
      schedule = {
        type: "repeating",
        runTime: input.runTime,
      };
    }
  }

  return {
    fieldErrors,
    firstInvalidField: getFirstInvalidField(fieldErrors, [
      "selectedMarketEpic",
      "size",
      "scheduleAt",
    ]),
    normalizedSize: fieldErrors.size ? undefined : normalizedSize,
    schedule,
  };
}

export function parseLocalDateTime(value: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseLocalTime(value: string): { hours: number; minutes: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) {
    return null;
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

export function getErrorMessage(error: unknown): string {
  const appError = error as Partial<AppError> | undefined;

  if (appError?.message) {
    return appError.detail ? `${appError.message} ${appError.detail}` : appError.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

function getFirstInvalidField<TFieldName extends string>(
  fieldErrors: Partial<Record<TFieldName, string>>,
  order: TFieldName[],
): TFieldName | undefined {
  return order.find((field) => Boolean(fieldErrors[field]));
}
