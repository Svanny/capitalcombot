import type { MarketSummary, QuoteSnapshot } from "@shared/types";
import type { FormEvent, RefObject } from "react";
import { formatDateTime, formatNumber, formatPercent } from "../lib/formatters";
import { WindowHelpButton } from "./WindowHelpButton";

interface MarketPanelProps {
  connected: boolean;
  loadingSearch: boolean;
  marketQuery: string;
  marketResults: MarketSummary[];
  onMarketQueryChange: (value: string) => void;
  onMarketSearch: (event?: FormEvent<HTMLFormElement>) => Promise<void>;
  onMarketSelect: (epic: string) => Promise<void>;
  orderError?: string;
  quote: QuoteSnapshot | null;
  searchInputRef: RefObject<HTMLInputElement | null>;
  selectedMarket: MarketSummary | null;
}

export function MarketPanel({
  connected,
  loadingSearch,
  marketQuery,
  marketResults,
  onMarketQueryChange,
  onMarketSearch,
  onMarketSelect,
  orderError,
  quote,
  searchInputRef,
  selectedMarket,
}: MarketPanelProps) {
  return (
    <section className="window section-window market-panel-window">
      <div className="title-bar">
        <div className="title-bar-text">Gold Market Selector</div>
        <div className="title-bar-controls">
          <WindowHelpButton
            title="Gold Market Selector"
            hints={[
              "Search and lock the instrument used in the trade tab.",
              "Connect first to search available Gold markets.",
              "Select a Gold instrument before placing an order.",
            ]}
          />
        </div>
      </div>
      <div className="window-body section-window-body">
        <div className="sunken-panel market-overview">
          <div>
            <h3>{selectedMarket?.instrumentName ?? "No Gold market selected"}</h3>
            <p className="muted">
              {selectedMarket
                ? `${selectedMarket.instrumentType} • ${selectedMarket.marketStatus}`
                : "Select a Gold instrument before placing an order."}
            </p>
          </div>
          <div className="quote-grid">
            <Metric label="Bid" value={quote?.bid ?? selectedMarket?.bid} />
            <Metric label="Ask" value={quote?.ask ?? selectedMarket?.ask} />
            <Metric
              label="Change"
              value={formatPercent(quote?.percentageChange ?? selectedMarket?.percentageChange)}
            />
            <Metric
              label="Updated"
              value={formatDateTime(quote?.updateTime ?? selectedMarket?.updateTime)}
            />
          </div>
        </div>

        {orderError ? (
          <div className="inline-banner error" role="alert">
            {orderError}
          </div>
        ) : null}

        <form className="search-form" onSubmit={onMarketSearch}>
          <div className="field-row-stacked search-label">
            <label>
              Search Gold instruments
              <input
                ref={searchInputRef}
                aria-describedby={orderError ? "selectedMarket-error" : undefined}
                name="marketSearch"
                placeholder="gold, spot gold, xau…"
                value={marketQuery}
                onChange={(event) => onMarketQueryChange(event.target.value)}
              />
            </label>
          </div>
          <button type="submit" className="default" disabled={!connected || loadingSearch}>
            {loadingSearch ? <LoadingLabel label="Searching" /> : "Search"}
          </button>
        </form>

        <div className="sunken-panel market-results" role="list" aria-label="Gold search results">
          {marketResults.length === 0 ? (
            <div className="empty-state compact">
              {connected
                ? "Search for Gold markets to choose the instrument you want to trade."
                : "Connect first to search available Gold markets."}
            </div>
          ) : (
            marketResults.map((market) => (
              <button
                key={market.epic}
                type="button"
                className={`market-result ${selectedMarket?.epic === market.epic ? "active" : ""}`}
                onClick={() => void onMarketSelect(market.epic)}
              >
                <span className="market-result-copy">
                  <strong>{market.instrumentName}</strong>
                  <span>{market.epic}</span>
                </span>
                <span className="market-status">{market.marketStatus}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string | null | undefined;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value ?? "—"}</strong>
    </div>
  );
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <span className="loading-label">
      <span className="loading-dot" aria-hidden="true" />
      {label}…
    </span>
  );
}
