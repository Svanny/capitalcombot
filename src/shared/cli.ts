export const CLI_METHODS = [
  "app.bootstrap",
  "auth.connect",
  "auth.connectSaved",
  "auth.disconnect",
  "auth.forgetSaved",
  "markets.searchGold",
  "markets.select",
  "quotes.getSelected",
  "positions.listOpen",
  "positions.close",
  "positions.reverse",
  "positions.updateProtection",
  "orders.openMarket",
  "orders.previewProtection",
  "schedules.list",
  "schedules.cancel",
  "schedules.pause",
  "schedules.reactivate",
  "schedules.update",
  "targetPosition.update",
] as const;

export type CliMethod = (typeof CLI_METHODS)[number];

export interface CliRequest {
  id: string;
  token: string;
  method: CliMethod | string;
  input?: unknown;
  confirmed?: boolean;
}

export type CliResponse =
  | { id: string; ok: true; result: unknown }
  | {
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
        detail?: string;
      };
    };

export interface CliConnectionInfo {
  version: 1;
  host: "127.0.0.1";
  port: number;
  token: string;
  pid: number;
}
