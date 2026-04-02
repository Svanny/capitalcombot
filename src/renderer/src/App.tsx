import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type {
  BootstrapState,
  CapitalCredentials,
  MarketSummary,
  OpenPosition,
  ProtectionStrategy,
  QuoteSnapshot,
  ResolvedProtection,
  ScheduledOrderJob,
  ScheduledOrderType,
  TradeDirection,
} from "@shared/types";
import {
  type AuthFieldName,
  type OrderFieldName,
  getErrorMessage,
  validateAuthForm,
  validateOrderForm,
} from "./lib/validation";
import {
  createProtectionFormFromStrategy,
  createProtectionFormFromPosition,
  EMPTY_PROTECTION_FORM,
  hasProtectionStrategy,
  type ProtectionFieldName,
  type ProtectionFormState,
  validateProtectionForm,
} from "./lib/protection-form";
import { ActivityFeed } from "./features/activity/ActivityFeed";
import { PositionProtectionPanel } from "./features/portfolio/PositionProtectionPanel";
import { PositionsPanel } from "./features/portfolio/PositionsPanel";
import { ConnectionPanel } from "./features/setup/ConnectionPanel";
import { MarketPanel } from "./features/trading/MarketPanel";
import { OrderTicket } from "./features/trading/OrderTicket";
import { SchedulePanel } from "./features/trading/SchedulePanel";
import { formatDateTime } from "./lib/formatters";
import { WindowHelpButton } from "./ui/WindowHelpButton";

const QUOTE_POLL_MS = 8_000;
const POSITIONS_POLL_MS = 12_000;
const TAB_ORDER = ["setup", "trade", "positions"] as const;
type TabId = (typeof TAB_ORDER)[number];
const TAB_LABELS: Record<TabId, string> = {
  setup: "Setup",
  trade: "Trading",
  positions: "Portfolio",
};

const EMPTY_BOOTSTRAP: BootstrapState = {
  connected: false,
  environment: "demo",
  selectedMarket: null,
  schedules: [],
  executionLog: [],
  savedProfile: null,
};

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>(EMPTY_BOOTSTRAP);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [quote, setQuote] = useState<QuoteSnapshot | null>(null);
  const [marketResults, setMarketResults] = useState<MarketSummary[]>([]);
  const [marketQuery, setMarketQuery] = useState("gold");
  const [direction, setDirection] = useState<TradeDirection>("BUY");
  const [size, setSize] = useState("1");
  const [wantsScheduledClose, setWantsScheduledClose] = useState(false);
  const [scheduleType, setScheduleType] = useState<ScheduledOrderType>("one-off");
  const [runAt, setRunAt] = useState("");
  const [runTime, setRunTime] = useState("");
  const [protectionForm, setProtectionForm] = useState<ProtectionFormState>(EMPTY_PROTECTION_FORM);
  const [protectionErrors, setProtectionErrors] = useState<Partial<Record<ProtectionFieldName, string>>>({});
  const [protectionPreview, setProtectionPreview] = useState<ResolvedProtection | null>(null);
  const [protectionPreviewError, setProtectionPreviewError] = useState<string | null>(null);
  const [editingProtectionPosition, setEditingProtectionPosition] = useState<OpenPosition | null>(null);
  const [positionProtectionForm, setPositionProtectionForm] =
    useState<ProtectionFormState>(EMPTY_PROTECTION_FORM);
  const [positionProtectionErrors, setPositionProtectionErrors] =
    useState<Partial<Record<ProtectionFieldName, string>>>({});
  const [positionProtectionPreview, setPositionProtectionPreview] = useState<ResolvedProtection | null>(
    null,
  );
  const [positionProtectionPreviewError, setPositionProtectionPreviewError] = useState<string | null>(null);
  const [editingScheduledOrderId, setEditingScheduledOrderId] = useState<string | null>(null);
  const [scheduledOrderDirection, setScheduledOrderDirection] = useState<TradeDirection>("BUY");
  const [scheduledOrderSize, setScheduledOrderSize] = useState("1");
  const [scheduledOrderType, setScheduledOrderType] = useState<ScheduledOrderType>("one-off");
  const [scheduledOrderRunAt, setScheduledOrderRunAt] = useState("");
  const [scheduledOrderRunTime, setScheduledOrderRunTime] = useState("");
  const [scheduledOrderProtectionForm, setScheduledOrderProtectionForm] =
    useState<ProtectionFormState>(EMPTY_PROTECTION_FORM);
  const [scheduledOrderErrors, setScheduledOrderErrors] =
    useState<Partial<Record<OrderFieldName, string>>>({});
  const [scheduledOrderProtectionErrors, setScheduledOrderProtectionErrors] =
    useState<Partial<Record<ProtectionFieldName, string>>>({});
  const [scheduledOrderProtectionPreview, setScheduledOrderProtectionPreview] =
    useState<ResolvedProtection | null>(null);
  const [scheduledOrderProtectionPreviewError, setScheduledOrderProtectionPreviewError] =
    useState<string | null>(null);
  const [authForm, setAuthForm] = useState<CapitalCredentials>({
    identifier: "",
    password: "",
    apiKey: "",
    environment: "demo",
  });
  const [authErrors, setAuthErrors] = useState<Partial<Record<AuthFieldName, string>>>({});
  const [orderErrors, setOrderErrors] = useState<Partial<Record<OrderFieldName, string>>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(readTabFromHash() ?? "setup");
  const [loadingState, setLoadingState] = useState({
    bootstrap: true,
    auth: false,
    marketSearch: false,
    order: false,
    protectionPreview: false,
    positions: false,
    positionProtectionPreview: false,
    positionProtectionSubmit: false,
    scheduleCancel: false,
    scheduleUpdate: false,
    scheduleProtectionPreview: false,
  });

  const authRefs = {
    identifier: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    apiKey: useRef<HTMLInputElement>(null),
  };
  const orderRefs = {
    selectedMarketEpic: useRef<HTMLInputElement>(null),
    size: useRef<HTMLInputElement>(null),
    scheduleAt: useRef<HTMLInputElement>(null),
  };
  const protectionRefs = {
    stopLossLevel: useRef<HTMLInputElement>(null),
    stopLossDistance: useRef<HTMLInputElement>(null),
    stopLossAdxMultiplier: useRef<HTMLInputElement>(null),
    takeProfitLevel: useRef<HTMLInputElement>(null),
    takeProfitDistance: useRef<HTMLInputElement>(null),
    takeProfitRiskRewardRatio: useRef<HTMLInputElement>(null),
    takeProfitAdxMultiplier: useRef<HTMLInputElement>(null),
  };
  const scheduleOrderRefs = {
    size: useRef<HTMLInputElement>(null),
    scheduleAt: useRef<HTMLInputElement>(null),
  };
  const scheduleProtectionRefs = {
    stopLossLevel: useRef<HTMLInputElement>(null),
    stopLossDistance: useRef<HTMLInputElement>(null),
    stopLossAdxMultiplier: useRef<HTMLInputElement>(null),
    takeProfitLevel: useRef<HTMLInputElement>(null),
    takeProfitDistance: useRef<HTMLInputElement>(null),
    takeProfitRiskRewardRatio: useRef<HTMLInputElement>(null),
    takeProfitAdxMultiplier: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    void hydrate();
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(readTabFromHash() ?? (bootstrap.connected ? "trade" : "setup"));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [bootstrap.connected]);

  useEffect(() => {
    if (!bootstrap.connected) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshConnectedData();
    }, Math.min(QUOTE_POLL_MS, POSITIONS_POLL_MS));

    return () => {
      window.clearInterval(interval);
    };
  }, [bootstrap.connected, bootstrap.selectedMarket?.epic]);

  useEffect(() => {
    if (!bootstrap.connected || !bootstrap.selectedMarket) {
      setProtectionPreview(null);
      setProtectionPreviewError(null);
      return;
    }

    const validation = validateProtectionForm(
      protectionForm,
      direction,
      getReferencePriceForDirection(quote ?? bootstrap.selectedMarket, direction),
    );

    if (!validation.strategy || !hasProtectionStrategy(validation.strategy)) {
      setProtectionPreview(null);
      setProtectionPreviewError(null);
      return;
    }

    let cancelled = false;
    setLoadingState((current) => ({ ...current, protectionPreview: true }));

    void window.capitalApi.orders
      .previewProtection({
        epic: bootstrap.selectedMarket.epic,
        direction,
        protection: validation.strategy,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }

        setProtectionPreview(response.preview);
        setProtectionPreviewError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setProtectionPreview(null);
        setProtectionPreviewError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingState((current) => ({ ...current, protectionPreview: false }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap.connected, bootstrap.selectedMarket, direction, protectionForm, quote]);

  useEffect(() => {
    if (!bootstrap.connected || !editingProtectionPosition) {
      setPositionProtectionPreview(null);
      setPositionProtectionPreviewError(null);
      return;
    }

    const validation = validateProtectionForm(
      positionProtectionForm,
      editingProtectionPosition.direction,
      getReferencePriceForDirection(editingProtectionPosition, editingProtectionPosition.direction),
    );

    if (!validation.strategy || !hasProtectionStrategy(validation.strategy)) {
      setPositionProtectionPreview(null);
      setPositionProtectionPreviewError(null);
      return;
    }

    let cancelled = false;
    setLoadingState((current) => ({ ...current, positionProtectionPreview: true }));

    void window.capitalApi.orders
      .previewProtection({
        epic: editingProtectionPosition.epic,
        direction: editingProtectionPosition.direction,
        protection: validation.strategy,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }

        setPositionProtectionPreview(response.preview);
        setPositionProtectionPreviewError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setPositionProtectionPreview(null);
        setPositionProtectionPreviewError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingState((current) => ({ ...current, positionProtectionPreview: false }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap.connected, editingProtectionPosition, positionProtectionForm]);

  useEffect(() => {
    if (!editingScheduledOrderId) {
      return;
    }

    const currentJob = bootstrap.schedules.find((job) => job.id === editingScheduledOrderId);

    if (!currentJob || currentJob.status !== "scheduled") {
      clearScheduledOrderEditor();
    }
  }, [bootstrap.schedules, editingScheduledOrderId]);

  useEffect(() => {
    const currentJob = editingScheduledOrderId
      ? bootstrap.schedules.find((job) => job.id === editingScheduledOrderId)
      : null;

    if (!bootstrap.connected || !currentJob) {
      setScheduledOrderProtectionPreview(null);
      setScheduledOrderProtectionPreviewError(null);
      return;
    }

    const priceContext = currentJob.epic === bootstrap.selectedMarket?.epic
      ? quote ?? bootstrap.selectedMarket
      : null;
    const validation = validateProtectionForm(
      scheduledOrderProtectionForm,
      scheduledOrderDirection,
      getReferencePriceForDirection(priceContext, scheduledOrderDirection),
    );

    if (!validation.strategy || !hasProtectionStrategy(validation.strategy)) {
      setScheduledOrderProtectionPreview(null);
      setScheduledOrderProtectionPreviewError(null);
      return;
    }

    let cancelled = false;
    setLoadingState((current) => ({ ...current, scheduleProtectionPreview: true }));

    void window.capitalApi.orders
      .previewProtection({
        epic: currentJob.epic,
        direction: scheduledOrderDirection,
        protection: validation.strategy,
      })
      .then((response) => {
        if (cancelled) {
          return;
        }

        setScheduledOrderProtectionPreview(response.preview);
        setScheduledOrderProtectionPreviewError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setScheduledOrderProtectionPreview(null);
        setScheduledOrderProtectionPreviewError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingState((current) => ({ ...current, scheduleProtectionPreview: false }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    bootstrap.connected,
    bootstrap.schedules,
    bootstrap.selectedMarket,
    editingScheduledOrderId,
    quote,
    scheduledOrderDirection,
    scheduledOrderProtectionForm,
  ]);

  const sortedExecutionLog = useMemo(
    () =>
      bootstrap.executionLog.slice().sort((left, right) => {
        return new Date(right.at).getTime() - new Date(left.at).getTime();
      }),
    [bootstrap.executionLog],
  );

  const sortedSchedules = useMemo(
    () =>
      bootstrap.schedules.slice().sort((left, right) => {
        return new Date(right.runAt).getTime() - new Date(left.runAt).getTime();
      }),
    [bootstrap.schedules],
  );
  const editingScheduledOrder = useMemo(
    () => bootstrap.schedules.find((job) => job.id === editingScheduledOrderId) ?? null,
    [bootstrap.schedules, editingScheduledOrderId],
  );

  const sortedPositions = useMemo(
    () =>
      positions.slice().sort((left, right) => {
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      }),
    [positions],
  );

  async function hydrate(): Promise<void> {
    setLoadingState((current) => ({ ...current, bootstrap: true }));

    try {
      const state = await window.capitalApi.app.bootstrap();
      applyBootstrap(state);
      if (state.connected) {
        await refreshConnectedData(state);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, bootstrap: false }));
    }
  }

  async function refreshConnectedData(baseState?: BootstrapState): Promise<void> {
    const state = baseState ?? (await window.capitalApi.app.bootstrap());
    applyBootstrap(state);

    if (!state.connected) {
      setPositions([]);
      setQuote(null);
      return;
    }

    try {
      const [nextPositions, nextQuote, nextSchedules] = await Promise.all([
        window.capitalApi.positions.listOpen(),
        state.selectedMarket ? window.capitalApi.quotes.getSelected() : Promise.resolve(null),
        window.capitalApi.schedules.list(),
      ]);

      setPositions(nextPositions);
      setQuote(nextQuote);
      setBootstrap((current) => ({
        ...current,
        schedules: nextSchedules,
      }));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function applyBootstrap(state: BootstrapState): void {
    setBootstrap(state);
    setActiveTab((current) => (TAB_ORDER.includes(current) ? current : state.connected ? "trade" : "setup"));
    setAuthForm((current) => ({
      ...current,
      environment: state.environment,
    }));
  }

  async function handleConnect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);

    const validation = validateAuthForm(authForm);
    setAuthErrors(validation.fieldErrors);

    if (validation.firstInvalidField) {
      focusAuthField(validation.firstInvalidField);
      return;
    }

    setLoadingState((current) => ({ ...current, auth: true }));

    try {
      const response = await window.capitalApi.auth.connect(authForm);
      setStatusMessage(response.result.message);
      setAuthErrors({});
      applyBootstrap(response.state);
      selectTab(response.state.selectedMarket ? "trade" : "setup");
      await refreshConnectedData(response.state);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, auth: false }));
    }
  }

  async function handleConnectSaved(): Promise<void> {
    setLoadingState((current) => ({ ...current, auth: true }));
    setErrorMessage(null);

    try {
      const response = await window.capitalApi.auth.connectSaved();
      setStatusMessage(response.result.message);
      setAuthErrors({});
      applyBootstrap(response.state);
      selectTab(response.state.selectedMarket ? "trade" : "setup");
      await refreshConnectedData(response.state);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, auth: false }));
    }
  }

  async function handleDisconnect(): Promise<void> {
    setLoadingState((current) => ({ ...current, auth: true }));
    setErrorMessage(null);

    try {
      const response = await window.capitalApi.auth.disconnect();
      setStatusMessage(response.result.message);
      setQuote(null);
      setPositions([]);
      applyBootstrap(response.state);
      selectTab("setup");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, auth: false }));
    }
  }

  async function handleForgetSaved(): Promise<void> {
    try {
      const nextState = await window.capitalApi.auth.forgetSaved();
      applyBootstrap(nextState);
      setStatusMessage("Removed saved Capital.com credentials from the keychain.");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleMarketSearch(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    setLoadingState((current) => ({ ...current, marketSearch: true }));
    setErrorMessage(null);

    try {
      const results = await window.capitalApi.markets.searchGold(marketQuery);
      setMarketResults(results);
      if (results.length === 0) {
        setStatusMessage("No markets matched that search.");
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, marketSearch: false }));
    }
  }

  async function handleMarketSelect(epic: string): Promise<void> {
    setErrorMessage(null);

    try {
      const market = await window.capitalApi.markets.select(epic);
      setBootstrap((current) => ({
        ...current,
        selectedMarket: market,
      }));
      setOrderErrors((current) => ({
        ...current,
        selectedMarketEpic: undefined,
      }));
      setQuote(await window.capitalApi.quotes.getSelected());
      setStatusMessage(`Selected ${market.instrumentName}.`);
      if (bootstrap.connected) {
        selectTab("trade");
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleOrderSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);

    const validation = validateOrderForm({
      size,
      runAt,
      runTime,
      scheduleType,
      wantsScheduledClose,
      selectedMarketEpic: bootstrap.selectedMarket?.epic ?? null,
    });

    setOrderErrors(validation.fieldErrors);

    const protectionValidation = validateProtectionForm(
      protectionForm,
      direction,
      getReferencePriceForDirection(quote ?? bootstrap.selectedMarket, direction),
    );
    setProtectionErrors(protectionValidation.fieldErrors);

    if (
      validation.firstInvalidField ||
      protectionValidation.firstInvalidField ||
      !bootstrap.selectedMarket
    ) {
      if (validation.firstInvalidField === "selectedMarketEpic") {
        selectTab("setup");
      }
      if (validation.firstInvalidField) {
        focusOrderField(validation.firstInvalidField);
      } else if (protectionValidation.firstInvalidField) {
        protectionRefs[protectionValidation.firstInvalidField].current?.focus();
      }
      setErrorMessage(
        Object.values(validation.fieldErrors)[0] ??
          Object.values(protectionValidation.fieldErrors)[0] ??
          "Select a market and fix the order form.",
      );
      return;
    }

    setLoadingState((current) => ({ ...current, order: true }));

    try {
      const response = await window.capitalApi.orders.openMarket({
        epic: bootstrap.selectedMarket.epic,
        direction,
        size: validation.normalizedSize!,
        schedule: validation.schedule,
        protection: protectionValidation.strategy,
      });
      setStatusMessage(response.result.message);
      setOrderErrors({});
      setProtectionErrors({});
      selectTab("positions");
      if (response.schedule) {
        setRunAt("");
        setRunTime("");
        setScheduleType("one-off");
        setWantsScheduledClose(false);
      }
      setProtectionForm(EMPTY_PROTECTION_FORM);
      setProtectionPreview(null);
      setProtectionPreviewError(null);
      await refreshConnectedData();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, order: false }));
    }
  }

  async function handlePositionClose(position: OpenPosition): Promise<void> {
    const confirmed = window.confirm(
      `Close ${position.instrumentName} ${position.direction} position ${position.dealId}?`,
    );

    if (!confirmed) {
      return;
    }

    setLoadingState((current) => ({ ...current, positions: true }));
    setErrorMessage(null);

    try {
      const response = await window.capitalApi.positions.close({
        dealId: position.dealId,
      });
      setStatusMessage(response.result.message);
      if (editingProtectionPosition?.dealId === position.dealId) {
        setEditingProtectionPosition(null);
      }
      selectTab("positions");
      await refreshConnectedData();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, positions: false }));
    }
  }

  async function handlePositionReverse(position: OpenPosition): Promise<void> {
    const nextDirection = position.direction === "BUY" ? "SELL" : "BUY";
    const confirmed = window.confirm(
      `Reverse ${position.instrumentName} ${position.dealId} into a ${nextDirection} position with size ${position.size}?`,
    );

    if (!confirmed) {
      return;
    }

    setLoadingState((current) => ({ ...current, positions: true }));
    setErrorMessage(null);

    try {
      const response = await window.capitalApi.positions.reverse({
        dealId: position.dealId,
      });
      setStatusMessage(response.result.message);
      if (editingProtectionPosition?.dealId === position.dealId) {
        setEditingProtectionPosition(null);
      }
      selectTab("positions");
      await refreshConnectedData();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, positions: false }));
    }
  }

  async function handleScheduleCancel(jobId: string): Promise<void> {
    setLoadingState((current) => ({ ...current, scheduleCancel: true }));
    setErrorMessage(null);

    try {
      const response = await window.capitalApi.schedules.cancel({ jobId });
      setStatusMessage(response.result.message);
      if (editingScheduledOrderId === jobId) {
        clearScheduledOrderEditor();
      }
      await refreshConnectedData();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, scheduleCancel: false }));
    }
  }

  function handleScheduleEdit(job: ScheduledOrderJob): void {
    setEditingScheduledOrderId(job.id);
    setScheduledOrderDirection(job.direction);
    setScheduledOrderSize(String(job.size));
    setScheduledOrderType(job.scheduleType);
    setScheduledOrderRunAt(job.scheduleType === "one-off" ? toLocalDateTimeInput(job.runAt) : "");
    setScheduledOrderRunTime(job.scheduleType === "repeating" ? job.runTime ?? "" : "");
    setScheduledOrderProtectionForm(createProtectionFormFromStrategy(job.protection));
    setScheduledOrderErrors({});
    setScheduledOrderProtectionErrors({});
    setScheduledOrderProtectionPreview(null);
    setScheduledOrderProtectionPreviewError(null);
  }

  function clearScheduledOrderEditor(): void {
    setEditingScheduledOrderId(null);
    setScheduledOrderErrors({});
    setScheduledOrderProtectionErrors({});
    setScheduledOrderProtectionPreview(null);
    setScheduledOrderProtectionPreviewError(null);
  }

  async function handleScheduleUpdate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!editingScheduledOrder) {
      return;
    }

    const validation = validateOrderForm({
      size: scheduledOrderSize,
      runAt: scheduledOrderRunAt,
      runTime: scheduledOrderRunTime,
      scheduleType: scheduledOrderType,
      wantsScheduledClose: true,
      selectedMarketEpic: editingScheduledOrder.epic,
    });
    setScheduledOrderErrors(validation.fieldErrors);

    const priceContext = editingScheduledOrder.epic === bootstrap.selectedMarket?.epic
      ? quote ?? bootstrap.selectedMarket
      : null;
    const protectionValidation = validateProtectionForm(
      scheduledOrderProtectionForm,
      scheduledOrderDirection,
      getReferencePriceForDirection(priceContext, scheduledOrderDirection),
    );
    setScheduledOrderProtectionErrors(protectionValidation.fieldErrors);

    if (validation.firstInvalidField || protectionValidation.firstInvalidField || !validation.schedule) {
      if (validation.firstInvalidField) {
        focusScheduledOrderField(validation.firstInvalidField);
      } else if (protectionValidation.firstInvalidField) {
        scheduleProtectionRefs[protectionValidation.firstInvalidField].current?.focus();
      }
      setErrorMessage(
        Object.values(validation.fieldErrors)[0] ??
          Object.values(protectionValidation.fieldErrors)[0] ??
          "Fix the scheduled order fields before saving.",
      );
      return;
    }

    setLoadingState((current) => ({ ...current, scheduleUpdate: true }));
    setErrorMessage(null);

    try {
      const response = await window.capitalApi.schedules.update({
        jobId: editingScheduledOrder.id,
        direction: scheduledOrderDirection,
        size: validation.normalizedSize!,
        schedule: validation.schedule,
        protection:
          protectionValidation.strategy && hasProtectionStrategy(protectionValidation.strategy)
            ? protectionValidation.strategy
            : null,
      });
      setStatusMessage(response.result.message);
      clearScheduledOrderEditor();
      await refreshConnectedData();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, scheduleUpdate: false }));
    }
  }

  function handleEditProtection(position: OpenPosition): void {
    setEditingProtectionPosition(position);
    setPositionProtectionForm(createProtectionFormFromPosition(position));
    setPositionProtectionErrors({});
    setPositionProtectionPreview(null);
    setPositionProtectionPreviewError(null);
  }

  async function handlePositionProtectionSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!editingProtectionPosition) {
      return;
    }

    const validation = validateProtectionForm(
      positionProtectionForm,
      editingProtectionPosition.direction,
      getReferencePriceForDirection(editingProtectionPosition, editingProtectionPosition.direction),
    );
    setPositionProtectionErrors(validation.fieldErrors);

    if (validation.firstInvalidField || !validation.strategy || !hasProtectionStrategy(validation.strategy)) {
      if (validation.firstInvalidField) {
        protectionRefs[validation.firstInvalidField].current?.focus();
      }
      setErrorMessage(
        Object.values(validation.fieldErrors)[0] ?? "Configure stop loss or take profit first.",
      );
      return;
    }

    setLoadingState((current) => ({ ...current, positionProtectionSubmit: true }));
    setErrorMessage(null);

    try {
      const response = await window.capitalApi.positions.updateProtection({
        dealId: editingProtectionPosition.dealId,
        epic: editingProtectionPosition.epic,
        direction: editingProtectionPosition.direction,
        protection: validation.strategy,
      });
      setStatusMessage(response.result.message);
      setEditingProtectionPosition(null);
      await refreshConnectedData();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLoadingState((current) => ({ ...current, positionProtectionSubmit: false }));
    }
  }

  function focusAuthField(field: AuthFieldName): void {
    window.setTimeout(() => {
      authRefs[field].current?.focus();
    }, 0);
  }

  function focusOrderField(field: OrderFieldName): void {
    window.setTimeout(() => {
      orderRefs[field].current?.focus();
    }, 0);
  }

  function focusScheduledOrderField(field: OrderFieldName): void {
    if (field === "selectedMarketEpic") {
      return;
    }

    window.setTimeout(() => {
      scheduleOrderRefs[field].current?.focus();
    }, 0);
  }

  const selectedMarket = bootstrap.selectedMarket;
  const toolbarStatus =
    errorMessage ??
    statusMessage ??
    (selectedMarket
      ? `${selectedMarket.instrumentName} • ${selectedMarket.marketStatus}`
      : "No primary market selected");

  return (
    <div className="desktop-shell">
      <div className="window shell-window">
        <div className="title-bar">
          <div className="title-bar-text">Capital.com Trading Assistant</div>
          <div className="title-bar-controls">
            <WindowHelpButton
              title="Capital.com Trading Assistant"
              hints={[
                "Use Setup to connect your account and pick the instrument you want to trade.",
                "The current workflow is primarily optimized for Gold discovery and Gold-first trading.",
                "Use Trading to place market orders immediately or queue them for later.",
                "Use Portfolio to monitor open positions and scheduled orders.",
              ]}
            />
          </div>
        </div>

        <div className="window-body shell-body">
          <a className="skip-link" href="#tabpanel-content">
            Skip to content
          </a>

          <menu
            role="tablist"
            aria-label="Trading workspace"
            className="workspace-tabs"
            onKeyDown={handleTabsKeyDown}
          >
            {TAB_ORDER.map((tabId) => (
              <li
                key={tabId}
                id={`tab-${tabId}`}
                role="tab"
                aria-controls={`panel-${tabId}`}
                aria-selected={activeTab === tabId}
              >
                <a
                  href={`#${tabId}`}
                  tabIndex={activeTab === tabId ? 0 : -1}
                  onClick={(event) => {
                    event.preventDefault();
                    selectTab(tabId);
                  }}
                >
                  {TAB_LABELS[tabId]}
                </a>
              </li>
            ))}
          </menu>

          <article
            id={`panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
            className="window tabpanel-window"
          >
            <div id="tabpanel-content" className="window-body tabpanel-body">
              {activeTab === "setup" ? (
                <div className="tab-stack setup-stack">
                  <ConnectionPanel
                    authErrors={authErrors}
                    authForm={authForm}
                    connected={bootstrap.connected}
                    errorMessage={errorMessage}
                    loadingAuth={loadingState.auth}
                  onConnectSaved={handleConnectSaved}
                  onDisconnect={handleDisconnect}
                  onForgetSaved={handleForgetSaved}
                  onSubmit={handleConnect}
                  savedProfile={bootstrap.savedProfile}
                  selectedMarket={selectedMarket}
                  onAuthChange={(field, value) => {
                    setAuthForm((current) => ({ ...current, [field]: value }));
                      setAuthErrors((current) => ({ ...current, [field]: undefined }));
                    }}
                    refs={authRefs}
                    statusMessage={statusMessage}
                  />

                  <MarketPanel
                    connected={bootstrap.connected}
                    loadingSearch={loadingState.marketSearch}
                    marketQuery={marketQuery}
                    marketResults={marketResults}
                    onMarketQueryChange={(value) => setMarketQuery(value)}
                    onMarketSearch={handleMarketSearch}
                    onMarketSelect={handleMarketSelect}
                    orderError={orderErrors.selectedMarketEpic}
                    quote={quote}
                    searchInputRef={orderRefs.selectedMarketEpic}
                    selectedMarket={selectedMarket}
                  />
                </div>
              ) : null}

              {activeTab === "trade" ? (
                <div className="tab-stack trading-stack">
                  <OrderTicket
                    closeAt={runAt}
                    closeTime={runTime}
                    connected={bootstrap.connected}
                    direction={direction}
                    errors={orderErrors}
                    loadingOrder={loadingState.order}
                    loadingProtectionPreview={loadingState.protectionPreview}
                    onCloseAtChange={(value) => {
                      setRunAt(value);
                      setOrderErrors((current) => ({ ...current, scheduleAt: undefined }));
                    }}
                    onCloseTimeChange={(value) => {
                      setRunTime(value);
                      setOrderErrors((current) => ({ ...current, scheduleAt: undefined }));
                    }}
                    onDirectionChange={setDirection}
                    onProtectionChange={(field, value) => {
                      setProtectionForm((current) => ({
                        ...current,
                        [field]: value,
                      }));
                      setProtectionErrors((current) => ({ ...current, [field]: undefined }));
                    }}
                    onScheduleTypeChange={(value) => {
                      setScheduleType(value);
                      setOrderErrors((current) => ({ ...current, scheduleAt: undefined }));
                    }}
                    onSubmit={handleOrderSubmit}
                    onToggleScheduledClose={(checked) => {
                      setWantsScheduledClose(checked);
                      setOrderErrors((current) => ({ ...current, scheduleAt: undefined }));
                    }}
                    onSizeChange={(value) => {
                      setSize(value);
                      setOrderErrors((current) => ({ ...current, size: undefined }));
                    }}
                    protectionErrors={protectionErrors}
                    protectionPreview={protectionPreview}
                    protectionPreviewError={protectionPreviewError}
                    protectionRefs={protectionRefs}
                    protectionValues={protectionForm}
                    refs={orderRefs}
                    scheduleType={scheduleType}
                    selectedMarket={selectedMarket}
                    size={size}
                    wantsScheduledClose={wantsScheduledClose}
                  />
                  <ActivityFeed
                    errorMessage={errorMessage}
                    executionLog={sortedExecutionLog}
                    statusMessage={statusMessage}
                  />
                </div>
              ) : null}

              {activeTab === "positions" ? (
                <div className="tab-stack portfolio-stack">
                  <PositionsPanel
                    onEditProtection={handleEditProtection}
                    loadingPositions={loadingState.positions}
                    onClosePosition={handlePositionClose}
                    onReversePosition={handlePositionReverse}
                    onRefresh={() => void refreshConnectedData()}
                    positions={sortedPositions}
                  />
                  <PositionProtectionPanel
                    editingPosition={editingProtectionPosition}
                    errors={positionProtectionErrors}
                    loadingPreview={loadingState.positionProtectionPreview}
                    loadingSubmit={loadingState.positionProtectionSubmit}
                    onCancel={() => setEditingProtectionPosition(null)}
                    onChange={(field, value) => {
                      setPositionProtectionForm((current) => ({
                        ...current,
                        [field]: value,
                      }));
                      setPositionProtectionErrors((current) => ({ ...current, [field]: undefined }));
                    }}
                    onSubmit={handlePositionProtectionSubmit}
                    preview={positionProtectionPreview}
                    previewError={positionProtectionPreviewError}
                    refs={protectionRefs}
                    values={positionProtectionForm}
                  />
                  <SchedulePanel
                    loadingCancel={loadingState.scheduleCancel}
                    editingJobId={editingScheduledOrderId}
                    editDirection={scheduledOrderDirection}
                    editErrors={scheduledOrderErrors}
                    editProtectionErrors={scheduledOrderProtectionErrors}
                    editProtectionPreview={scheduledOrderProtectionPreview}
                    editProtectionPreviewError={scheduledOrderProtectionPreviewError}
                    editProtectionRefs={scheduleProtectionRefs}
                    editProtectionValues={scheduledOrderProtectionForm}
                    editRunAt={scheduledOrderRunAt}
                    editRunTime={scheduledOrderRunTime}
                    editScheduleType={scheduledOrderType}
                    editSize={scheduledOrderSize}
                    loadingEditPreview={loadingState.scheduleProtectionPreview}
                    loadingUpdate={loadingState.scheduleUpdate}
                    onCancel={(job) => handleScheduleCancel(job.id)}
                    onEdit={handleScheduleEdit}
                    onEditCancel={clearScheduledOrderEditor}
                    onEditDirectionChange={setScheduledOrderDirection}
                    onEditProtectionChange={(field, value) => {
                      setScheduledOrderProtectionForm((current) => ({
                        ...current,
                        [field]: value,
                      }));
                      setScheduledOrderProtectionErrors((current) => ({ ...current, [field]: undefined }));
                    }}
                    onEditRunAtChange={(value) => {
                      setScheduledOrderRunAt(value);
                      setScheduledOrderErrors((current) => ({ ...current, scheduleAt: undefined }));
                    }}
                    onEditRunTimeChange={(value) => {
                      setScheduledOrderRunTime(value);
                      setScheduledOrderErrors((current) => ({ ...current, scheduleAt: undefined }));
                    }}
                    onEditScheduleTypeChange={(value) => {
                      setScheduledOrderType(value);
                      setScheduledOrderErrors((current) => ({ ...current, scheduleAt: undefined }));
                    }}
                    onEditSizeChange={(value) => {
                      setScheduledOrderSize(value);
                      setScheduledOrderErrors((current) => ({ ...current, size: undefined }));
                    }}
                    onEditSubmit={handleScheduleUpdate}
                    refs={scheduleOrderRefs}
                    schedules={sortedSchedules}
                  />
                </div>
              ) : null}
            </div>
          </article>
        </div>

        <footer className="status-bar">
          <p className="status-bar-field">{toolbarStatus}</p>
          <p className="status-bar-field">Positions: {positions.length}</p>
          <p className="status-bar-field">
            Last quote: {formatDateTime(quote?.updateTime ?? selectedMarket?.updateTime)}
          </p>
        </footer>
      </div>
    </div>
  );

  function selectTab(tabId: TabId): void {
    if (window.location.hash !== `#${tabId}`) {
      window.history.replaceState(null, "", `#${tabId}`);
    }
    setActiveTab(tabId);
  }

  function handleTabsKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const currentIndex = TAB_ORDER.indexOf(activeTab);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TAB_ORDER.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = TAB_ORDER[nextIndex];
    selectTab(nextTab);
    window.setTimeout(() => {
      document.querySelector<HTMLAnchorElement>(`#tab-${nextTab} a`)?.focus();
    }, 0);
  }
}

function readTabFromHash(): TabId | null {
  const hash = window.location.hash.replace("#", "");
  return TAB_ORDER.includes(hash as TabId) ? (hash as TabId) : null;
}

function getReferencePriceForDirection(
  market: Pick<MarketSummary | QuoteSnapshot | OpenPosition, "bid" | "ask"> | null | undefined,
  direction: TradeDirection,
): number | null {
  if (!market) {
    return null;
  }

  return direction === "BUY" ? market.ask ?? market.bid : market.bid ?? market.ask;
}

function toLocalDateTimeInput(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const offsetMinutes = parsed.getTimezoneOffset();
  const local = new Date(parsed.getTime() - offsetMinutes * 60_000);
  return local.toISOString().slice(0, 16);
}
