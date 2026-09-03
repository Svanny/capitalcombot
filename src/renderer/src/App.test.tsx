// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BootstrapState, CapitalDesktopApi, MarketSummary, OpenPosition } from "@shared/types";
import App from "./App";

const selectedMarket: MarketSummary = {
  epic: "XAUUSD",
  instrumentName: "Spot Gold",
  symbol: "XAUUSD",
  instrumentType: "COMMODITIES",
  marketStatus: "TRADEABLE",
  bid: 3010.1,
  ask: 3010.8,
  percentageChange: 0.4,
  updateTime: "2026-03-23T10:00:00.000Z",
};

const disconnectedBootstrap: BootstrapState = {
  connected: false,
  environment: "demo",
  selectedMarket: null,
  schedules: [],
  executionLog: [],
  savedProfile: null,
};

const disconnectedWithSavedBootstrap: BootstrapState = {
  ...disconnectedBootstrap,
  savedProfile: {
    identifier: "saved@example.com",
    environment: "live",
  },
};

const connectedBootstrap: BootstrapState = {
  connected: true,
  environment: "demo",
  selectedMarket,
  schedules: [
    {
      id: "job-1",
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "BUY",
      size: 1,
      scheduleType: "one-off",
      runAt: "2026-03-23T11:00:00.000Z",
      status: "scheduled",
      createdAt: "2026-03-23T10:00:00.000Z",
    },
    {
      id: "job-2",
      epic: "XAUUSD",
      instrumentName: "Spot Gold",
      direction: "SELL",
      size: 1,
      scheduleType: "one-off",
      runAt: "2026-03-23T12:00:00.000Z",
      status: "executed",
      createdAt: "2026-03-23T10:30:00.000Z",
      reason: "Market order placed automatically at the scheduled time.",
    },
  ],
  executionLog: [
    {
      action: "market",
      status: "success",
      message: "Selected Spot Gold.",
      at: "2026-03-23T09:00:00.000Z",
    },
    {
      action: "auth",
      status: "success",
      message: "Connected to Capital.com demo environment.",
      at: "2026-03-23T10:00:00.000Z",
    },
  ],
  savedProfile: {
    identifier: "trader@example.com",
    environment: "demo",
  },
};

const connectedWithoutMarketBootstrap: BootstrapState = {
  connected: true,
  environment: "demo",
  selectedMarket: null,
  schedules: [],
  executionLog: [],
  savedProfile: {
    identifier: "trader@example.com",
    environment: "demo",
  },
};

function buildPosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    dealId: "deal-1",
    dealReference: "p_deal-1",
    epic: "XAUUSD",
    instrumentName: "Spot Gold",
    direction: "BUY",
    size: 1,
    level: 3010.5,
    currency: "USD",
    pnl: 0,
    bid: 3010.1,
    ask: 3010.8,
    createdAt: "2026-03-23T10:00:00.000Z",
    stopLevel: null,
    profitLevel: null,
    ...overrides,
  };
}

function buildApi(
  bootstrap: BootstrapState,
  options: {
    positions?: OpenPosition[];
  } = {},
): CapitalDesktopApi {
  return {
    app: {
      bootstrap: vi.fn(async () => bootstrap),
    },
    auth: {
      connect: vi.fn(),
      connectSaved: vi.fn(),
      disconnect: vi.fn(),
      forgetSaved: vi.fn(),
    },
    markets: {
      searchGold: vi.fn(async () => []),
      select: vi.fn(),
    },
    quotes: {
      getSelected: vi.fn(async () =>
        bootstrap.selectedMarket
          ? {
              epic: bootstrap.selectedMarket.epic,
              instrumentName: bootstrap.selectedMarket.instrumentName,
              bid: bootstrap.selectedMarket.bid,
              ask: bootstrap.selectedMarket.ask,
              marketStatus: bootstrap.selectedMarket.marketStatus,
              percentageChange: bootstrap.selectedMarket.percentageChange,
              updateTime: bootstrap.selectedMarket.updateTime,
            }
          : null,
      ),
    },
    positions: {
      listOpen: vi.fn(async () => options.positions ?? []),
      close: vi.fn(),
      reverse: vi.fn(),
      updateProtection: vi.fn(async () => ({
        position: buildPosition({
          stopLevel: 3000,
          profitLevel: 3030,
        }),
        result: {
          action: "order" as const,
          status: "success" as const,
          message: "Updated protection.",
          at: "2026-03-23T10:05:00.000Z",
        },
      })),
    },
    orders: {
      openMarket: vi.fn(),
      previewProtection: vi.fn(async () => ({
        preview: {
          referencePrice: 3010.8,
          stopLevel: 3000.8,
          profitLevel: 3030.8,
          stopDistance: 10,
          profitDistance: 20,
          adxValue: null,
        },
      })),
    },
    schedules: {
      list: vi.fn(async () => bootstrap.schedules),
      cancel: vi.fn(async () => ({
        schedules: [],
        result: {
          action: "schedule" as const,
          status: "info" as const,
          message: "Cancelled scheduled order.",
          at: "2026-03-23T10:00:00.000Z",
        },
      })),
      pause: vi.fn(async () => ({
        schedules: bootstrap.schedules,
        result: {
          action: "schedule" as const,
          status: "info" as const,
          message: "Paused scheduled order.",
          at: "2026-03-23T10:00:00.000Z",
        },
      })),
      reactivate: vi.fn(async () => ({
        schedules: bootstrap.schedules,
        result: {
          action: "schedule" as const,
          status: "success" as const,
          message: "Reactivated scheduled order for Spot Gold.",
          at: "2026-03-23T10:00:00.000Z",
        },
      })),
      update: vi.fn(async () => ({
        schedules: bootstrap.schedules,
        result: {
          action: "schedule" as const,
          status: "success" as const,
          message: "Updated scheduled order for Spot Gold.",
          at: "2026-03-23T10:00:00.000Z",
        },
      })),
    },
  };
}

function toLocalDateTimeInput(value: string): string {
  const parsed = new Date(value);
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("shows the expanded setup form when disconnected", async () => {
    window.capitalApi = buildApi(disconnectedBootstrap);

    render(<App />);

    expect(await screen.findByText("Account Session")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Setup" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Account identifier")).toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse setup/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Help for Account Session" }));

    expect(screen.getByRole("dialog", { name: "Account Session help" })).toBeInTheDocument();
    expect(screen.getByText("Connection details and saved account.")).toBeInTheDocument();
  });

  it("keeps the auth form editable and updates the summary from live input instead of saved data", async () => {
    window.capitalApi = buildApi(disconnectedWithSavedBootstrap);

    render(<App />);

    const identifierInput = await screen.findByLabelText("Account identifier");

    expect(identifierInput).toHaveValue("");
    expect(screen.queryByText("saved@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("Saved account available")).toBeInTheDocument();
    expect(screen.getByText("DEMO")).toBeInTheDocument();

    fireEvent.change(identifierInput, {
      target: { value: "live-trader@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Environment"), {
      target: { value: "live" },
    });

    expect(screen.getByText("live-trader@example.com")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("keeps setup editable after connected bootstrap", async () => {
    window.capitalApi = buildApi(connectedBootstrap);

    render(<App />);

    expect(await screen.findByLabelText("Account identifier")).toBeInTheDocument();
    expect(screen.getByText("Capital.com Trading Assistant")).toBeInTheDocument();
    expect(screen.getAllByText("XAUUSD").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /hide setup|edit setup|open setup/i })).not.toBeInTheDocument();
  });

  it("keeps password and API key in the form after a successful connect", async () => {
    const api = buildApi(disconnectedBootstrap);
    const connectState: BootstrapState = {
      ...connectedWithoutMarketBootstrap,
      savedProfile: {
        identifier: "trader@example.com",
        environment: "demo",
      },
    };

    api.auth.connect = vi.fn(async () => ({
      state: connectState,
      result: {
        action: "auth" as const,
        status: "success" as const,
        message: "Connected to Capital.com demo environment.",
        at: "2026-03-23T10:00:00.000Z",
      },
    }));

    window.capitalApi = api;

    render(<App />);

    const identifierInput = await screen.findByLabelText("Account identifier");
    const passwordInput = screen.getByLabelText("Password");
    const apiKeyInput = screen.getByLabelText("API key");

    fireEvent.change(identifierInput, { target: { value: "trader@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "secret-pass" } });
    fireEvent.change(apiKeyInput, { target: { value: "cap-api-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(api.auth.connect).toHaveBeenCalledWith({
        identifier: "trader@example.com",
        password: "secret-pass",
        apiKey: "cap-api-key",
        environment: "demo",
      });
    });

    expect(await screen.findByRole("tab", { name: "Portfolio" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("link", { name: "Setup" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toHaveValue("secret-pass");
      expect(screen.getByLabelText("API key")).toHaveValue("cap-api-key");
    });
  });

  it("rehydrates the password and API key when bootstrap returns a connected saved session", async () => {
    window.capitalApi = buildApi(connectedBootstrap);

    render(<App />);

    expect(await screen.findByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });

  it("renders inline validation and focuses the first invalid order field", async () => {
    window.capitalApi = buildApi(connectedWithoutMarketBootstrap);

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Trading" }));
    const submitButton = await screen.findByRole("button", { name: "Buy Market Order" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getAllByText("Select a market before submitting an order.").length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByLabelText("Search instruments")).toHaveFocus();
  });

  it("shows auth errors inline in the account session panel", async () => {
    const api = buildApi(disconnectedBootstrap);
    api.auth.connect = vi.fn(async () => {
      throw { message: "Invalid Capital.com credentials." };
    });
    window.capitalApi = api;

    render(<App />);

    fireEvent.change(await screen.findByLabelText("Account identifier"), {
      target: { value: "trader@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "api-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid Capital.com credentials.");
  });

  it("shows guided empty states in monitoring sections", async () => {
    window.capitalApi = buildApi(disconnectedBootstrap);

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));
    expect(await screen.findByText("No open positions.")).toBeInTheDocument();
    expect(await screen.findByText("No active orders.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Failed (0)" }));
    expect(await screen.findByText("No failed orders.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Cancelled (0)" }));
    expect(await screen.findByText("No cancelled orders.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Trading" }));
    expect(await screen.findByText("No execution history yet.")).toBeInTheDocument();
  });

  it("shows pause, edit, and cancel only for scheduled orders", async () => {
    window.capitalApi = buildApi(connectedBootstrap);

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));

    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Active (1)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Failed (0)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cancelled (0)" })).toBeInTheDocument();
    expect(screen.queryByText("executed", { exact: true })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(1);
  });

  it("shows resume and reactivate actions for paused and cancelled orders", async () => {
    const bootstrap: BootstrapState = {
      ...connectedBootstrap,
      schedules: [
        {
          ...connectedBootstrap.schedules[0],
          id: "paused-job",
          status: "paused",
          reason: "Paused manually",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "cancelled-job",
          status: "cancelled",
          reason: "Cancelled manually",
        },
      ],
    };
    window.capitalApi = buildApi(bootstrap);

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));

    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Cancelled (1)" }));
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("pauses and reactivates scheduled orders from the portfolio tab", async () => {
    const api = buildApi(connectedBootstrap);
    const pausedSchedules = [
      {
        ...connectedBootstrap.schedules[0],
        status: "paused" as const,
        reason: "Paused manually",
      },
      connectedBootstrap.schedules[1],
    ];
    const reactivatedSchedules = [
      {
        ...connectedBootstrap.schedules[0],
        status: "scheduled" as const,
        reason: "Scheduled order reactivated.",
      },
      connectedBootstrap.schedules[1],
    ];
    api.schedules.list = vi
      .fn()
      .mockResolvedValueOnce(connectedBootstrap.schedules)
      .mockResolvedValueOnce(pausedSchedules)
      .mockResolvedValue(reactivatedSchedules);
    api.schedules.pause = vi.fn(async () => ({
      schedules: pausedSchedules,
      result: {
        action: "schedule" as const,
        status: "info" as const,
        message: "Paused scheduled order.",
        at: "2026-03-23T10:00:00.000Z",
      },
    }));
    api.schedules.reactivate = vi.fn(async () => ({
      schedules: reactivatedSchedules,
      result: {
        action: "schedule" as const,
        status: "success" as const,
        message: "Reactivated scheduled order for Spot Gold.",
        at: "2026-03-23T10:00:00.000Z",
      },
    }));
    window.capitalApi = api;

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(api.schedules.pause).toHaveBeenCalledWith({ jobId: "job-1" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(api.schedules.reactivate).toHaveBeenCalledWith({ jobId: "job-1" });
    });
  });

  it("shows stale one-off reactivation errors", async () => {
    const bootstrap: BootstrapState = {
      ...connectedBootstrap,
      schedules: [
        {
          ...connectedBootstrap.schedules[0],
          id: "cancelled-job",
          runAt: "2026-03-23T08:00:00.000Z",
          status: "cancelled",
          reason: "Cancelled manually",
        },
      ],
    };
    const api = buildApi(bootstrap);
    api.schedules.reactivate = vi.fn(async () => {
      throw { message: "Edit this one-off scheduled order to a future time before reactivating it." };
    });
    window.capitalApi = api;

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));
    fireEvent.click(await screen.findByRole("link", { name: "Cancelled (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));

    expect(
      await screen.findByText("Edit this one-off scheduled order to a future time before reactivating it."),
    ).toBeInTheDocument();
  });

  it("prefills and saves scheduled order edits from the portfolio tab", async () => {
    const api = buildApi(connectedBootstrap);
    const updatedSchedules = [
      {
        ...connectedBootstrap.schedules[0],
        direction: "SELL" as const,
        size: 2,
        scheduleType: "repeating" as const,
        runAt: "2026-03-23T14:30:00.000Z",
        runTime: "14:30",
      },
      connectedBootstrap.schedules[1],
    ];
    api.schedules.list = vi
      .fn()
      .mockResolvedValueOnce(connectedBootstrap.schedules)
      .mockResolvedValue(updatedSchedules);
    api.schedules.update = vi.fn(async () => ({
      schedules: updatedSchedules,
      result: {
        action: "schedule" as const,
        status: "success" as const,
        message: "Updated scheduled order for Spot Gold.",
        at: "2026-03-23T10:00:00.000Z",
      },
    }));
    window.capitalApi = api;

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(await screen.findByLabelText("Size")).toHaveValue(1);
    expect(screen.getByRole("button", { name: "Target position" })).toBeDisabled();
    expect(screen.queryByRole("switch", { name: /Target position/i })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(toLocalDateTimeInput("2026-03-23T11:00:00.000Z"))).toBeInTheDocument();
    const buyRadio = screen.getByLabelText("Buy");
    expect(buyRadio).toBeChecked();
    expect(buyRadio.nextElementSibling).toHaveTextContent("Buy");

    fireEvent.click(screen.getByLabelText("Sell"));
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Repeating daily"));
    fireEvent.change(screen.getByLabelText("Run daily at"), { target: { value: "14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(api.schedules.update).toHaveBeenCalledWith({
        jobId: "job-1",
        direction: "SELL",
        size: 2,
        schedule: {
          type: "repeating",
          runTime: "14:30",
        },
        protection: null,
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    });
  });

  it("opens the target-position popup from the scheduled-order tab row for an eligible pair", async () => {
    const bootstrap: BootstrapState = {
      ...connectedBootstrap,
      schedules: [
        {
          ...connectedBootstrap.schedules[0],
          scheduleType: "repeating",
          runTime: "03:30",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "job-late",
          direction: "SELL",
          size: 4,
          scheduleType: "repeating",
          runTime: "05:30",
          runAt: "2026-03-23T12:00:00.000Z",
          status: "paused",
        },
      ],
    };
    const api = buildApi(bootstrap);
    const updatedSchedules = bootstrap.schedules.map((job, index) => ({
      ...job,
      direction: index === 0 ? ("SELL" as const) : job.direction,
      size: index === 0 ? 3 : job.size,
      status: index === 1 ? ("paused" as const) : job.status,
      targetPosition: {
        pairId: "target-test",
        leg: index === 0 ? ("early" as const) : ("late" as const),
        direction: "SELL" as const,
        size: 3,
      },
    }));
    api.schedules.update = vi.fn(async () => ({
      schedules: updatedSchedules,
      result: {
        action: "schedule" as const,
        status: "success" as const,
        message: "Updated scheduled order for Spot Gold.",
        at: "2026-03-23T10:00:00.000Z",
      },
    }));
    api.schedules.list = vi.fn().mockResolvedValueOnce(bootstrap.schedules).mockResolvedValue(updatedSchedules);
    window.capitalApi = api;

    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));
    const targetButton = await screen.findByRole("button", { name: "Target position" });
    expect(targetButton).toBeEnabled();
    expect(targetButton.closest(".schedule-nav-row")).toContainElement(
      screen.getByRole("tablist", { name: "Scheduled order status" }),
    );
    fireEvent.click(targetButton);

    expect(screen.getByRole("dialog", { name: "Scheduled Target Position" })).toBeInTheDocument();
    const targetSwitch = screen.getByRole("switch", { name: /Enable target position/i });
    expect(targetSwitch).toBeEnabled();
    fireEvent.click(targetSwitch);
    expect(screen.getByLabelText("Target size")).toHaveValue(1);

    fireEvent.click(screen.getByLabelText("Short"));
    fireEvent.change(screen.getByLabelText("Target size"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(api.schedules.update).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-1",
          direction: "BUY",
          size: 1,
          protection: null,
          targetPosition: { enabled: true, direction: "SELL", size: 3 },
        }),
      );
    });
    expect(screen.queryByRole("dialog", { name: "Scheduled Target Position" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(targetButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("3 Spot Gold")).toBeInTheDocument();
      expect(screen.getAllByText("paused")[0].closest(".schedule-card")).toBeInTheDocument();
    });
  });

  it("fills every credential field after using saved credentials", async () => {
    const api = buildApi(disconnectedWithSavedBootstrap);
    api.auth.connectSaved = vi.fn(async () => ({
      state: {
        ...connectedWithoutMarketBootstrap,
        environment: "live" as const,
      },
      credentials: {
        identifier: "saved@example.com",
        password: "saved-password",
        apiKey: "saved-api-key",
        environment: "live" as const,
      },
      result: {
        action: "auth" as const,
        status: "success" as const,
        message: "Connected with saved credentials.",
        at: "2026-03-23T10:00:00.000Z",
      },
    }));
    window.capitalApi = api;

    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Setup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use saved" }));

    expect(await screen.findByRole("tab", { name: "Portfolio" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("link", { name: "Setup" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Environment")).toHaveValue("live");
      expect(screen.getByLabelText("Account identifier")).toHaveValue("saved@example.com");
      expect(screen.getByLabelText("Password")).toHaveValue("saved-password");
      expect(screen.getByLabelText("API key")).toHaveValue("saved-api-key");
    });
  });

  it("groups schedules into counted tabs and sorts each tab by its status-specific time", async () => {
    const bootstrap: BootstrapState = {
      ...connectedBootstrap,
      schedules: [
        {
          ...connectedBootstrap.schedules[0],
          id: "active-later",
          direction: "SELL",
          runAt: "2026-03-23T14:00:00.000Z",
          status: "scheduled",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "active-earlier",
          direction: "BUY",
          runAt: "2026-03-23T11:00:00.000Z",
          status: "paused",
          reason: "Paused manually",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "failed-new",
          direction: "SELL",
          runAt: "2026-03-23T08:00:00.000Z",
          lastAttemptAt: "2026-03-23T13:00:00.000Z",
          status: "failed",
          reason: "Most recent failure",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "missed-middle",
          direction: "BUY",
          runAt: "2026-03-23T07:00:00.000Z",
          lastAttemptAt: "2026-03-23T12:00:00.000Z",
          status: "missed",
          reason: "Missed execution",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "failed-fallback",
          direction: "BUY",
          runAt: "2026-03-23T11:00:00.000Z",
          status: "failed",
          reason: "Fallback failure",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "cancelled-old",
          direction: "BUY",
          createdAt: "2026-03-23T09:00:00.000Z",
          runAt: "2026-03-23T14:00:00.000Z",
          status: "cancelled",
          reason: "Older cancellation",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "cancelled-new",
          direction: "SELL",
          createdAt: "2026-03-23T14:00:00.000Z",
          runAt: "2026-03-23T08:00:00.000Z",
          status: "cancelled",
          reason: "Newer cancellation",
        },
        {
          ...connectedBootstrap.schedules[0],
          id: "executed-job",
          runAt: "2026-03-23T15:00:00.000Z",
          status: "executed",
        },
      ],
    };
    window.capitalApi = buildApi(bootstrap);

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));

    expect(screen.getByRole("tab", { name: "Active (2)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Failed (3)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cancelled (2)" })).toBeInTheDocument();

    const getVisibleScheduleCards = () => Array.from(document.querySelectorAll<HTMLElement>(".schedule-card"));
    let scheduleCards = getVisibleScheduleCards();
    expect(scheduleCards[0]).toHaveTextContent("BUY 1 Spot Gold");
    expect(scheduleCards[1]).toHaveTextContent("SELL 1 Spot Gold");
    expect(screen.getByText("BUY", { exact: true })).toHaveClass("order-direction", "order-direction-buy");
    expect(screen.getByText("SELL", { exact: true })).toHaveClass("order-direction", "order-direction-sell");
    expect(screen.getByText("scheduled", { exact: true })).toHaveClass("status-pill", "status-scheduled");
    expect(screen.queryByText("executed", { exact: true })).not.toBeInTheDocument();

    const activeTab = screen.getByRole("link", { name: "Active (2)" });
    fireEvent.keyDown(activeTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Failed (3)" })).toHaveAttribute("aria-selected", "true");

    scheduleCards = getVisibleScheduleCards();
    expect(scheduleCards[0]).toHaveTextContent("Most recent failure");
    expect(scheduleCards[1]).toHaveTextContent("Missed execution");
    expect(scheduleCards[2]).toHaveTextContent("Fallback failure");
    screen.getAllByText("failed", { exact: true }).forEach((status) => {
      expect(status).toHaveClass("status-pill", "status-failed");
    });
    expect(screen.getByText("missed", { exact: true })).toHaveClass("status-pill", "status-missed");

    fireEvent.click(screen.getByRole("link", { name: "Cancelled (2)" }));
    scheduleCards = getVisibleScheduleCards();
    expect(scheduleCards[0]).toHaveTextContent("Newer cancellation");
    expect(scheduleCards[1]).toHaveTextContent("Older cancellation");
    screen.getAllByText("cancelled", { exact: true }).forEach((status) => {
      expect(status).toHaveClass("status-pill", "status-cancelled");
    });
  });

  it("renders activity, active schedules, and positions in their configured chronological order", async () => {
    const api = buildApi(connectedBootstrap, {
      positions: [
        buildPosition({
          dealId: "deal-older",
          createdAt: "2026-03-23T08:00:00.000Z",
          instrumentName: "Older Gold",
        }),
        buildPosition({
          dealId: "deal-newer",
          createdAt: "2026-03-23T11:00:00.000Z",
          instrumentName: "Newer Gold",
        }),
      ],
    });
    window.capitalApi = api;

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Trading" }));
    const activityEntries = await screen.findAllByText(/Connected to Capital.com demo environment.|Selected Spot Gold\./);
    expect(activityEntries[0]).toHaveTextContent("Connected to Capital.com demo environment.");

    fireEvent.click(screen.getByRole("link", { name: "Portfolio" }));
    const scheduleCards = screen.getAllByText(/One-off at/);
    expect(scheduleCards).toHaveLength(1);
    expect(scheduleCards[0].closest(".schedule-card")).toHaveTextContent("BUY 1 Spot Gold");

    const positionsTable = screen.getByRole("table");
    const bodyRows = within(positionsTable).getAllByRole("row").slice(1);
    expect(bodyRows[0]).toHaveTextContent("Newer Gold");
    expect(bodyRows[1]).toHaveTextContent("Older Gold");
  });
});
