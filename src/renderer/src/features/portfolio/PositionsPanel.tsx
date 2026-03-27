import type { OpenPosition } from "@shared/types";
import { formatCurrency, formatNumber } from "../../lib/formatters";
import { WindowHelpButton } from "../../ui/WindowHelpButton";

interface PositionsPanelProps {
  onEditProtection: (position: OpenPosition) => void;
  loadingPositions: boolean;
  onClosePosition: (position: OpenPosition) => Promise<void>;
  onReversePosition: (position: OpenPosition) => Promise<void>;
  onRefresh: () => void;
  positions: OpenPosition[];
}

export function PositionsPanel({
  onEditProtection,
  loadingPositions,
  onClosePosition,
  onReversePosition,
  onRefresh,
  positions,
}: PositionsPanelProps) {
  return (
    <section className="window section-window positions-window">
      <div className="title-bar">
        <div className="title-bar-text">Open Positions</div>
        <div className="title-bar-controls">
          <WindowHelpButton
            title="Open Positions"
            hints={[
              "Live Capital.com positions with close and reverse actions.",
              "Refresh pulls the latest open positions from Capital.com.",
            ]}
          />
        </div>
      </div>
      <div className="window-body section-window-body positions-window-body">
        <div className="panel-actions">
          <button type="button" className="ghost" onClick={onRefresh}>
            Refresh
          </button>
        </div>

        <div className="sunken-panel table-wrap">
          <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Direction</th>
              <th>Size</th>
              <th>Entry</th>
              <th>SL / TP</th>
              <th>P/L</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <strong>No open positions.</strong>
                    <p>Connect, select a market, and place a buy or sell order to see live trades here.</p>
                  </div>
                </td>
              </tr>
            ) : (
              positions.map((position) => (
                  <tr key={position.dealId}>
                    <td className="market-cell">
                      <strong>{position.instrumentName}</strong>
                      <div className="secondary-line">{position.dealId}</div>
                    </td>
                    <td>{position.direction}</td>
                    <td>{formatNumber(position.size)}</td>
                    <td>{formatNumber(position.level)}</td>
                    <td>
                      <div className="secondary-line">
                        SL {position.stopLevel !== null ? formatNumber(position.stopLevel) : "—"}
                      </div>
                      <div className="secondary-line">
                        TP {position.profitLevel !== null ? formatNumber(position.profitLevel) : "—"}
                      </div>
                    </td>
                    <td className={position.pnl >= 0 ? "positive" : "negative"}>
                      {formatCurrency(position.pnl, position.currency)}
                    </td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => onEditProtection(position)}
                          disabled={loadingPositions}
                          aria-label={`Edit protection for position ${position.dealId}`}
                        >
                          Protection
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void onReversePosition(position)}
                          disabled={loadingPositions}
                          aria-label={`Reverse position ${position.dealId}`}
                        >
                          Reverse
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void onClosePosition(position)}
                          disabled={loadingPositions}
                          aria-label={`Close position ${position.dealId}`}
                        >
                          Close
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
            )}
          </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
