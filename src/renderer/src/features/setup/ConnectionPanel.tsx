import type { CapitalCredentials, MarketSummary, SavedProfile } from "@shared/types";
import type { FormEvent, ReactNode, RefObject } from "react";
import type { AuthFieldName } from "../../lib/validation";
import { WindowHelpButton } from "../../ui/WindowHelpButton";

interface ConnectionPanelProps {
  authErrors: Partial<Record<AuthFieldName, string>>;
  authForm: CapitalCredentials;
  connected: boolean;
  errorMessage: string | null;
  loadingAuth: boolean;
  onAuthChange: (field: keyof CapitalCredentials, value: string) => void;
  onConnectSaved: () => void;
  onDisconnect: () => void;
  onForgetSaved: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  refs: Record<AuthFieldName, RefObject<HTMLInputElement | null>>;
  savedProfile: SavedProfile | null;
  selectedMarket: MarketSummary | null;
  statusMessage: string | null;
}

export function ConnectionPanel({
  authErrors,
  authForm,
  connected,
  errorMessage,
  loadingAuth,
  onAuthChange,
  onConnectSaved,
  onDisconnect,
  onForgetSaved,
  onSubmit,
  refs,
  savedProfile,
  selectedMarket,
  statusMessage,
}: ConnectionPanelProps) {
  return (
    <section className="window section-window">
      <div className="title-bar">
        <div className="title-bar-text">Account Session</div>
        <div className="title-bar-controls">
          <WindowHelpButton
            title="Account Session"
            hints={[
              "Connection details and saved account.",
              "Credentials stay in the macOS keychain.",
              "Capital.com API requests run only in the Electron main process.",
            ]}
          />
        </div>
      </div>
      <div className="window-body section-window-body">
        <div className="summary-strip" role="status" aria-live="polite">
          <SummaryItem
            label="Status"
            value={loadingAuth ? "Connecting…" : connected ? "Connected" : "Not connected"}
          />
          <SummaryItem
            label="Account"
            value={savedProfile?.identifier ?? (authForm.identifier || "No saved account")}
          />
          <SummaryItem label="Environment" value={authForm.environment.toUpperCase()} />
          <SummaryItem label="Market" value={selectedMarket?.epic ?? "No primary market selected"} />
        </div>

        <div className="inline-actions">
          <button type="button" className="ghost" onClick={onConnectSaved} disabled={loadingAuth || !savedProfile}>
            {loadingAuth ? <LoadingLabel label="Connecting" /> : "Use saved"}
          </button>
          <button type="button" className="ghost" onClick={onDisconnect} disabled={loadingAuth || !connected}>
            Disconnect
          </button>
          <button type="button" className="ghost" onClick={onForgetSaved} disabled={!savedProfile}>
            Forget saved
          </button>
        </div>

        {statusMessage ? <div className="status-banner success">{statusMessage}</div> : null}
        {errorMessage ? (
          <div className="status-banner error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <form className="setup-form" onSubmit={onSubmit} noValidate>
          <div className="auth-form-grid">
            <div className="field-shell">
              <div className="auth-field-row">
                <label className="auth-label" htmlFor="environment">
                  Environment
                </label>
                <select
                  id="environment"
                  className="auth-control auth-select"
                  name="environment"
                  value={authForm.environment}
                  onChange={(event) => onAuthChange("environment", event.target.value)}
                >
                  <option value="demo">Demo</option>
                  <option value="live">Live</option>
                </select>
              </div>
            </div>

            <FormFieldError error={authErrors.identifier}>
              <div className="auth-field-row">
                <label className="auth-label" htmlFor="identifier">
                  Account identifier
                </label>
                <input
                  id="identifier"
                  ref={refs.identifier}
                  className="auth-control"
                  aria-invalid={Boolean(authErrors.identifier)}
                  autoComplete="username"
                  inputMode="email"
                  name="identifier"
                  placeholder="name@example.com…"
                  value={authForm.identifier}
                  onChange={(event) => onAuthChange("identifier", event.target.value)}
                />
              </div>
            </FormFieldError>

            <FormFieldError error={authErrors.password}>
              <div className="auth-field-row">
                <label className="auth-label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  ref={refs.password}
                  className="auth-control"
                  aria-invalid={Boolean(authErrors.password)}
                  autoComplete="current-password"
                  name="password"
                  type="password"
                  placeholder="Capital.com password…"
                  value={authForm.password}
                  onChange={(event) => onAuthChange("password", event.target.value)}
                />
              </div>
            </FormFieldError>

            <FormFieldError error={authErrors.apiKey}>
              <div className="auth-field-row">
                <label className="auth-label" htmlFor="apiKey">
                  API key
                </label>
                <input
                  id="apiKey"
                  ref={refs.apiKey}
                  className="auth-control"
                  aria-invalid={Boolean(authErrors.apiKey)}
                  autoComplete="off"
                  name="apiKey"
                  placeholder="CAP-API-KEY…"
                  spellCheck={false}
                  type="password"
                  value={authForm.apiKey}
                  onChange={(event) => onAuthChange("apiKey", event.target.value)}
                />
              </div>
            </FormFieldError>

            <div className="button-row auth-button-row">
              <button type="submit" className="default" disabled={loadingAuth}>
                {loadingAuth ? <LoadingLabel label="Connecting" /> : "Connect"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}

function FormFieldError({
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
