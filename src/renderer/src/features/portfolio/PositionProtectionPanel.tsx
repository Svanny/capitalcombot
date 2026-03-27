import type { OpenPosition, ResolvedProtection } from "@shared/types";
import type { FormEvent, RefObject } from "react";
import { type ProtectionFieldName, type ProtectionFormState } from "../../lib/protection-form";
import { ProtectionStrategyFields } from "../../ui/ProtectionStrategyFields";
import { WindowHelpButton } from "../../ui/WindowHelpButton";

interface PositionProtectionPanelProps {
  editingPosition: OpenPosition | null;
  errors: Partial<Record<ProtectionFieldName, string>>;
  loadingPreview: boolean;
  loadingSubmit: boolean;
  onCancel: () => void;
  onChange: <TField extends keyof ProtectionFormState>(field: TField, value: ProtectionFormState[TField]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  preview: ResolvedProtection | null;
  previewError: string | null;
  refs: Partial<Record<ProtectionFieldName, RefObject<HTMLInputElement | null>>>;
  values: ProtectionFormState;
}

export function PositionProtectionPanel({
  editingPosition,
  errors,
  loadingPreview,
  loadingSubmit,
  onCancel,
  onChange,
  onSubmit,
  preview,
  previewError,
  refs,
  values,
}: PositionProtectionPanelProps) {
  if (!editingPosition) {
    return null;
  }

  return (
    <section className="window section-window">
      <div className="title-bar">
        <div className="title-bar-text">Position Protection</div>
        <div className="title-bar-controls">
          <WindowHelpButton
            title="Position Protection"
            hints={[
              "Review or update stop-loss and take-profit values for an open position.",
              "Protection values are previewed against the current market quote before submission.",
            ]}
          />
        </div>
      </div>
      <div className="window-body section-window-body">
        <div className="summary-strip trade-summary">
          <div className="summary-item">
            <span>Position</span>
            <strong>{editingPosition.instrumentName}</strong>
          </div>
          <div className="summary-item">
            <span>Direction</span>
            <strong>{editingPosition.direction}</strong>
          </div>
          <div className="summary-item">
            <span>Entry</span>
            <strong>{editingPosition.level}</strong>
          </div>
          <div className="summary-item">
            <span>Deal</span>
            <strong>{editingPosition.dealId}</strong>
          </div>
        </div>

        <form className="order-form" onSubmit={onSubmit} noValidate>
          <ProtectionStrategyFields
            errors={errors}
            loadingPreview={loadingPreview}
            onChange={onChange}
            preview={preview}
            previewError={previewError}
            refs={refs}
            values={values}
          />

          <div className="button-row">
            <button type="submit" className="default" disabled={loadingSubmit}>
              {loadingSubmit ? "Updating…" : "Update Protection"}
            </button>
            <button type="button" className="ghost" onClick={onCancel} disabled={loadingSubmit}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
