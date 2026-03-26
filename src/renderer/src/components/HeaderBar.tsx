import type { MarketSummary, QuoteSnapshot, TradingEnvironment } from "@shared/types";
import { formatNumber, formatPercent } from "../lib/formatters";

interface HeaderBarProps {
  connected: boolean;
  environment: TradingEnvironment;
  positionsCount: number;
  quote: QuoteSnapshot | null;
  schedulesCount: number;
  selectedMarket: MarketSummary | null;
}

export function HeaderBar({
  connected,
  environment,
  positionsCount,
  quote,
  schedulesCount,
  selectedMarket,
}: HeaderBarProps) {
  return (
    <header className="topbar">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="topbar-copy">
        <p className="eyebrow">Capital.com desktop</p>
        <h1>Capital.com trading workspace</h1>
        <p className="topbar-note">
          Guided order flow with live market context and scheduled order tracking.
        </p>
      </div>

      <div className="topbar-meta">
        <div className="status-row">
          <span className={`status-pill ${connected ? "live" : "idle"}`}>
            {connected ? "Connected" : "Offline"}
          </span>
          <span className="status-pill subtle">{environment.toUpperCase()}</span>
        </div>

        <div className="hero-grid">
          <MetricCard
            label="Selected market"
            value={selectedMarket?.instrumentName ?? "No primary market selected"}
            meta={selectedMarket?.epic ?? "Select a market in setup"}
          />
          <MetricCard
            label="Quote"
            value={
              quote
                ? `${formatNumber(quote.bid)} / ${formatNumber(quote.ask)}`
                : "Waiting for market"
            }
            meta={quote ? formatPercent(quote.percentageChange) : "No active quote"}
          />
          <MetricCard label="Open positions" value={String(positionsCount)} meta="Tracked locally" />
          <MetricCard label="Order queue" value={String(schedulesCount)} meta="Scheduled jobs" />
        </div>
      </div>
    </header>
  );
}

function MetricCard({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="hero-card">
      <span className="hero-label">{label}</span>
      <strong className="hero-value">{value}</strong>
      <span className="hero-meta">{meta}</span>
    </div>
  );
}
