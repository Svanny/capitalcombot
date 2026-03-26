import type { MarketSummary, ResolvedProtection, ScheduledOrderType, TradeDirection } from "@shared/types";
import type { FormEvent, RefObject } from "react";
import type { ProtectionFieldName, ProtectionFormState } from "../lib/protection-form";
import { formatNumber } from "../lib/formatters";
import type { OrderFieldName } from "../lib/validation";
import { ProtectionStrategyFields } from "./ProtectionStrategyFields";
import { WindowHelpButton } from "./WindowHelpButton";

interface OrderTicketProps {
  closeAt: string;
  closeTime: string;
  connected: boolean;
  direction: TradeDirection;
  errors: Partial<Record<OrderFieldName, string>>;
  loadingOrder: boolean;
  loadingProtectionPreview: boolean;
  onCloseAtChange: (value: string) => void;
  onCloseTimeChange: (value: string) => void;
  onDirectionChange: (direction: TradeDirection) => void;
  onProtectionChange: <TField extends keyof ProtectionFormState>(
    field: TField,
    value: ProtectionFormState[TField],
  ) => void;
  onScheduleTypeChange: (value: ScheduledOrderType) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onToggleScheduledClose: (checked: boolean) => void;
  onSizeChange: (value: string) => void;
  protectionErrors: Partial<Record<ProtectionFieldName, string>>;
  protectionPreview: ResolvedProtection | null;
  protectionPreviewError: string | null;
  protectionRefs: Partial<Record<ProtectionFieldName, RefObject<HTMLInputElement | null>>>;
  protectionValues: ProtectionFormState;
  refs: Record<OrderFieldName, RefObject<HTMLInputElement | null>>;
  scheduleType: ScheduledOrderType;
  selectedMarket: MarketSummary | null;
  size: string;
  wantsScheduledClose: boolean;
}

export function OrderTicket({
  closeAt,
  closeTime,
  connected,
  direction,
  errors,
  loadingOrder,
  loadingProtectionPreview,
  onCloseAtChange,
  onCloseTimeChange,
  onDirectionChange,
  onProtectionChange,
  onScheduleTypeChange,
  onSubmit,
  onToggleScheduledClose,
  onSizeChange,
  protectionErrors,
  protectionPreview,
  protectionPreviewError,
  protectionRefs,
  protectionValues,
  refs,
  scheduleType,
  selectedMarket,
  size,
  wantsScheduledClose,
}: OrderTicketProps) {
  return (
    <section className="window section-window">
      <div className="title-bar">
        <div className="title-bar-text">Trade Ticket</div>
        <div className="title-bar-controls">
          <WindowHelpButton
            title="Trade Ticket"
            hints={[
              "Submit a market buy or sell for the selected Gold instrument.",
              "Leave scheduling off to place the market order immediately.",
              "One-off schedules queue a single market order at a chosen date and time.",
              "Repeating schedules queue a market order every day at the chosen local time while this desktop app stays open.",
              "Protection values can use raw levels, raw distances, risk/reward, or ADX-derived distance.",
            ]}
          />
        </div>
      </div>
      <div className="window-body section-window-body">
        <div className="panel-heading compact">
          <span className="ticket-context">
            {selectedMarket ? selectedMarket.epic : "Select market in setup"}
          </span>
        </div>

        <div className="summary-strip trade-summary">
          <SummaryItem label="Selected market" value={selectedMarket?.instrumentName ?? "No Gold market selected"} />
          <SummaryItem label="Working side" value={direction} />
          <SummaryItem
            label="Size preview"
            value={Number.isFinite(Number(size)) ? formatNumber(Number(size)) : "—"}
          />
        </div>

        <form className="order-form" onSubmit={onSubmit} noValidate>
          <fieldset>
            <legend>Direction</legend>
            <div className="field-row">
              <input
                id="trade-direction-buy"
                type="radio"
                name="direction"
                checked={direction === "BUY"}
                onChange={() => onDirectionChange("BUY")}
              />
              <label htmlFor="trade-direction-buy">Buy</label>
            </div>
            <div className="field-row">
              <input
                id="trade-direction-sell"
                type="radio"
                name="direction"
                checked={direction === "SELL"}
                onChange={() => onDirectionChange("SELL")}
              />
              <label htmlFor="trade-direction-sell">Sell</label>
            </div>
          </fieldset>

          <div className={errors.size ? "field-shell has-error" : "field-shell"}>
            <div className="field-row-stacked">
              <label>
                Size
                <input
                  ref={refs.size}
                  aria-invalid={Boolean(errors.size)}
                  inputMode="decimal"
                  min="0.01"
                  name="size"
                  placeholder="1.0…"
                  step="0.01"
                  type="number"
                  value={size}
                  onChange={(event) => onSizeChange(event.target.value)}
                />
              </label>
            </div>
            {errors.size ? <p className="field-error">{errors.size}</p> : null}
          </div>

          <ProtectionStrategyFields
            errors={protectionErrors}
            loadingPreview={loadingProtectionPreview}
            onChange={onProtectionChange}
            preview={protectionPreview}
            previewError={protectionPreviewError}
            refs={protectionRefs}
            values={protectionValues}
          />

          <div className="field-row">
            <input
              id="scheduled-close"
              checked={wantsScheduledClose}
              name="scheduledClose"
              type="checkbox"
              onChange={(event) => onToggleScheduledClose(event.target.checked)}
            />
            <label htmlFor="scheduled-close">Schedule this market order for later</label>
          </div>

          {wantsScheduledClose ? (
            <>
              <fieldset>
                <legend>Schedule type</legend>
                <div className="field-row">
                  <input
                    id="schedule-type-one-off"
                    type="radio"
                    name="scheduleType"
                    checked={scheduleType === "one-off"}
                    onChange={() => onScheduleTypeChange("one-off")}
                  />
                  <label htmlFor="schedule-type-one-off">One-off</label>
                </div>
                <div className="field-row">
                  <input
                    id="schedule-type-repeating"
                    type="radio"
                    name="scheduleType"
                    checked={scheduleType === "repeating"}
                    onChange={() => onScheduleTypeChange("repeating")}
                  />
                  <label htmlFor="schedule-type-repeating">Repeating daily</label>
                </div>
              </fieldset>

              <div className={errors.scheduleAt ? "field-shell has-error" : "field-shell"}>
                <div className="field-row-stacked">
                    <label>
                    {scheduleType === "one-off" ? "Run once at" : "Run daily at"}
                    <input
                      ref={refs.scheduleAt}
                      aria-invalid={Boolean(errors.scheduleAt)}
                      name={scheduleType === "one-off" ? "closeAt" : "closeTime"}
                      type={scheduleType === "one-off" ? "datetime-local" : "time"}
                      value={scheduleType === "one-off" ? closeAt : closeTime}
                      onChange={(event) =>
                        scheduleType === "one-off"
                          ? onCloseAtChange(event.target.value)
                          : onCloseTimeChange(event.target.value)
                      }
                    />
                  </label>
                </div>
                {errors.scheduleAt ? <p className="field-error">{errors.scheduleAt}</p> : null}
              </div>
            </>
          ) : null}

          <div className="button-row">
            <button type="submit" className="default" disabled={!connected || loadingOrder}>
              {loadingOrder ? (
                <LoadingLabel label="Submitting" />
              ) : wantsScheduledClose ? (
                direction === "BUY" ? (
                  "Schedule Buy Gold"
                ) : (
                  "Schedule Sell Gold"
                )
              ) : direction === "BUY" ? (
                "Buy Gold"
              ) : (
                "Sell Gold"
              )}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
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
