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
      message: "Selected Gold.",
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
    },
  };
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

  it("keeps setup editable after connected bootstrap", async () => {
    window.capitalApi = buildApi(connectedBootstrap);

    render(<App />);

    expect(await screen.findByLabelText("Account identifier")).toBeInTheDocument();
    expect(screen.getByText("Capital.com Gold Trading Assitant")).toBeInTheDocument();
    expect(screen.getAllByText("XAUUSD").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /hide setup|edit setup|open setup/i })).not.toBeInTheDocument();
  });

  it("renders inline validation and focuses the first invalid order field", async () => {
    window.capitalApi = buildApi(connectedWithoutMarketBootstrap);

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Trading" }));
    const submitButton = await screen.findByRole("button", { name: "Buy Gold" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getAllByText("Select a Gold market before submitting an order.").length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByLabelText("Search Gold instruments")).toHaveFocus();
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
    expect(await screen.findByText("No open Gold positions.")).toBeInTheDocument();
    expect(await screen.findByText("No scheduled orders.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Trading" }));
    expect(await screen.findByText("No execution history yet.")).toBeInTheDocument();
  });

  it("shows cancel only for scheduled orders", async () => {
    window.capitalApi = buildApi(connectedBootstrap);

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Portfolio" }));

    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getAllByText("executed").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
  });

  it("renders activity, schedules, and positions in descending chronological order", async () => {
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
    const activityEntries = await screen.findAllByText(/Connected to Capital.com demo environment.|Selected Gold\./);
    expect(activityEntries[0]).toHaveTextContent("Connected to Capital.com demo environment.");

    fireEvent.click(screen.getByRole("link", { name: "Portfolio" }));
    const scheduleCards = screen.getAllByText(/One-off at/);
    expect(scheduleCards[0].closest(".schedule-card")).toHaveTextContent("SELL 1 Spot Gold");
    expect(scheduleCards[1].closest(".schedule-card")).toHaveTextContent("BUY 1 Spot Gold");

    const positionsTable = screen.getByRole("table");
    const bodyRows = within(positionsTable).getAllByRole("row").slice(1);
    expect(bodyRows[0]).toHaveTextContent("Newer Gold");
    expect(bodyRows[1]).toHaveTextContent("Older Gold");
  });
});
