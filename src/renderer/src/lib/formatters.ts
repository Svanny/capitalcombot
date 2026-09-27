export function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  }).format(value);
}

export function formatCurrency(value: number, currency: string): string {
  if (!Number.isFinite(value)) return formatNumber(null);
  if (!/^[a-z]{3}$/i.test(currency)) return formatNumber(value);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }

  return `${value.toFixed(2)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) {
    return "—";
  }

  const parsed = new Date();
  parsed.setHours(Number(match[1]), Number(match[2]), 0, 0);

  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(parsed);
}
