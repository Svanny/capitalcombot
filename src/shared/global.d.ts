import type { CapitalDesktopApi } from "./types";

declare global {
  interface Window {
    capitalApi: CapitalDesktopApi;
  }
}

export {};
