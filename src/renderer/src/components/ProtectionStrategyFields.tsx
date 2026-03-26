import type { ResolvedProtection, StopLossMode, TakeProfitMode } from "@shared/types";
import type { ReactNode, RefObject } from "react";
import {
  EMPTY_PROTECTION_FORM,
  formatResolvedProtection,
  type ProtectionFieldName,
  type ProtectionFormState,
} from "../lib/protection-form";

interface ProtectionStrategyFieldsProps {
  errors: Partial<Record<ProtectionFieldName, string>>;
  loadingPreview: boolean;
  onChange: <TField extends keyof ProtectionFormState>(field: TField, value: ProtectionFormState[TField]) => void;
  preview: ResolvedProtection | null;
  previewError: string | null;
  refs?: Partial<Record<ProtectionFieldName, RefObject<HTMLInputElement | null>>>;
  values: ProtectionFormState;
}

export function ProtectionStrategyFields({
  errors,
  loadingPreview,
  onChange,
  preview,
  previewError,
  refs,
  values,
}: ProtectionStrategyFieldsProps) {
  return (
    <fieldset className="protection-strategy">
      <legend>Protection Strategy</legend>

      <div className="protection-grid">
        <div className="sunken-panel protection-block">
          <strong>Stop loss</strong>
          <label>
            Mode
            <select
              value={values.stopLossMode}
              onChange={(event) => onChange("stopLossMode", event.target.value as StopLossMode)}
            >
              <option value="none">None</option>
              <option value="price_level">Price level</option>
              <option value="distance">Distance</option>
              <option value="adx_distance">ADX distance</option>
            </select>
          </label>

          {values.stopLossMode === "price_level" ? (
            <FieldError error={errors.stopLossLevel}>
              <label>
                Stop-loss level
                <input
                  ref={refs?.stopLossLevel}
                  type="number"
                  step="0.0001"
                  value={values.stopLossLevel}
                  onChange={(event) => onChange("stopLossLevel", event.target.value)}
                />
              </label>
            </FieldError>
          ) : null}

          {values.stopLossMode === "distance" ? (
            <FieldError error={errors.stopLossDistance}>
              <label>
                Stop-loss distance
                <input
                  ref={refs?.stopLossDistance}
                  type="number"
                  step="0.0001"
                  value={values.stopLossDistance}
                  onChange={(event) => onChange("stopLossDistance", event.target.value)}
                />
              </label>
            </FieldError>
          ) : null}

          {values.stopLossMode === "adx_distance" ? (
            <FieldError error={errors.stopLossAdxMultiplier}>
              <label>
                ADX multiplier
                <input
                  ref={refs?.stopLossAdxMultiplier}
                  type="number"
                  step="0.1"
                  value={values.stopLossAdxMultiplier}
                  onChange={(event) => onChange("stopLossAdxMultiplier", event.target.value)}
                />
              </label>
            </FieldError>
          ) : null}
        </div>

        <div className="sunken-panel protection-block">
          <strong>Take profit</strong>
          <label>
            Mode
            <select
              value={values.takeProfitMode}
              onChange={(event) => onChange("takeProfitMode", event.target.value as TakeProfitMode)}
            >
              <option value="none">None</option>
              <option value="price_level">Price level</option>
              <option value="distance">Distance</option>
              <option value="risk_reward">Risk / reward</option>
              <option value="adx_distance">ADX distance</option>
            </select>
          </label>

          {values.takeProfitMode === "price_level" ? (
            <FieldError error={errors.takeProfitLevel}>
              <label>
                Take-profit level
                <input
                  ref={refs?.takeProfitLevel}
                  type="number"
                  step="0.0001"
                  value={values.takeProfitLevel}
                  onChange={(event) => onChange("takeProfitLevel", event.target.value)}
                />
              </label>
            </FieldError>
          ) : null}

          {values.takeProfitMode === "distance" ? (
            <FieldError error={errors.takeProfitDistance}>
              <label>
                Take-profit distance
                <input
                  ref={refs?.takeProfitDistance}
                  type="number"
                  step="0.0001"
                  value={values.takeProfitDistance}
                  onChange={(event) => onChange("takeProfitDistance", event.target.value)}
                />
              </label>
            </FieldError>
          ) : null}

          {values.takeProfitMode === "risk_reward" ? (
            <FieldError error={errors.takeProfitRiskRewardRatio}>
              <label>
                Risk / reward ratio
                <input
                  ref={refs?.takeProfitRiskRewardRatio}
                  type="number"
                  step="0.1"
                  value={values.takeProfitRiskRewardRatio}
                  onChange={(event) => onChange("takeProfitRiskRewardRatio", event.target.value)}
                />
              </label>
            </FieldError>
          ) : null}

          {values.takeProfitMode === "adx_distance" ? (
            <FieldError error={errors.takeProfitAdxMultiplier}>
              <label>
                ADX multiplier
                <input
                  ref={refs?.takeProfitAdxMultiplier}
                  type="number"
                  step="0.1"
                  value={values.takeProfitAdxMultiplier}
                  onChange={(event) => onChange("takeProfitAdxMultiplier", event.target.value)}
                />
              </label>
            </FieldError>
          ) : null}
        </div>
      </div>

      <div className="status-banner">
        {loadingPreview ? "Calculating protection preview…" : formatResolvedProtection(preview)}
      </div>
      {previewError ? <div className="status-banner error">{previewError}</div> : null}
    </fieldset>
  );
}

function FieldError({
  children,
  error,
}: {
  children: ReactNode;
  error?: string;
}) {
  return (
    <div className={error ? "field-shell has-error" : "field-shell"}>
      {children}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

export function resetProtectionFieldForMode(
  values: ProtectionFormState,
  field: keyof ProtectionFormState,
  nextMode: StopLossMode | TakeProfitMode,
): ProtectionFormState {
  if (field === "stopLossMode") {
    return {
      ...values,
      stopLossMode: nextMode as StopLossMode,
      stopLossLevel: nextMode === "price_level" ? values.stopLossLevel : EMPTY_PROTECTION_FORM.stopLossLevel,
      stopLossDistance:
        nextMode === "distance" ? values.stopLossDistance : EMPTY_PROTECTION_FORM.stopLossDistance,
      stopLossAdxMultiplier:
        nextMode === "adx_distance"
          ? values.stopLossAdxMultiplier
          : EMPTY_PROTECTION_FORM.stopLossAdxMultiplier,
    };
  }

  return {
    ...values,
    takeProfitMode: nextMode as TakeProfitMode,
    takeProfitLevel:
      nextMode === "price_level" ? values.takeProfitLevel : EMPTY_PROTECTION_FORM.takeProfitLevel,
    takeProfitDistance:
      nextMode === "distance" ? values.takeProfitDistance : EMPTY_PROTECTION_FORM.takeProfitDistance,
    takeProfitRiskRewardRatio:
      nextMode === "risk_reward"
        ? values.takeProfitRiskRewardRatio
        : EMPTY_PROTECTION_FORM.takeProfitRiskRewardRatio,
    takeProfitAdxMultiplier:
      nextMode === "adx_distance"
        ? values.takeProfitAdxMultiplier
        : EMPTY_PROTECTION_FORM.takeProfitAdxMultiplier,
  };
}
