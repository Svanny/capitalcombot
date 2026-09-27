import { describe, expect, it } from "vitest";
import { formatCurrency, formatNumber, formatPercent } from "./formatters";

describe("broker number formatting", () => {
  it.each([NaN, Infinity, -Infinity])("does not present non-finite data as a price: %s", (value) => {
    expect(formatNumber(value)).toBe("—");
    expect(formatPercent(value)).toBe("—");
    expect(formatCurrency(value, "USD")).toBe("—");
  });

  it.each(["", "$", "USDT"])("falls back to a number for unsupported currency syntax %j", (currency) => {
    expect(formatCurrency(12.5, currency)).toBe(formatNumber(12.5));
  });

  it("preserves valid currency formatting", () => {
    expect(formatCurrency(12.5, "USD")).toBe(new Intl.NumberFormat(undefined, {
      style: "currency", currency: "USD", maximumFractionDigits: 2,
    }).format(12.5));
  });
});
