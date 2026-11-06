import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, NativeImage } from "electron";
import { MemoryAppStateStore } from "../state/app-store";
import type { ScheduledOrderJob } from "../../shared/types";

const mocks = vi.hoisted(() => ({ start: vi.fn(() => 0), stop: vi.fn(), quit: vi.fn(),
  confirm: vi.fn(() => 0), trayFails: false, menu: [] as Array<{ label?: string; click?: () => void }> }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: Object.assign(new EventEmitter(), { quit: mocks.quit }),
    dialog: { showMessageBoxSync: mocks.confirm },
    powerSaveBlocker: { start: mocks.start, stop: mocks.stop },
    Menu: { buildFromTemplate: (items: typeof mocks.menu) => { mocks.menu = items; return items; } },
    Tray: class extends EventEmitter {
      constructor() { super(); if (mocks.trayFails) throw new Error("no tray"); }
      setToolTip() {} setContextMenu() {} destroy() {}
    },
  };
});
import { app } from "electron";
import { protectScheduleRuntime } from "./schedule-runtime";

const job: ScheduledOrderJob = { id: "late", epic: "GOLD", instrumentName: "Gold", direction: "BUY",
  size: 0.78, scheduleType: "repeating", runTime: "05:30", runAt: "2026-11-07T22:30:00Z",
  status: "scheduled", createdAt: "2026-11-06T00:00:00Z" };
function setup(jobs: ScheduledOrderJob[] = [job]) {
  const original = new MemoryAppStateStore();
  original.setSchedules(jobs);
  const show = vi.fn();
  const runtime = protectScheduleRuntime(original, { resize: vi.fn() } as unknown as NativeImage, show, vi.fn());
  const window = Object.assign(new EventEmitter(), { hide: vi.fn(), minimize: vi.fn() });
  runtime.attachWindow(window as unknown as BrowserWindow);
  return { ...runtime, window, show };
}
beforeEach(() => {
  vi.stubEnv("CAPITALCOMBOT_SUPERVISED", "0");
  vi.clearAllMocks(); app.removeAllListeners(); mocks.trayFails = false; mocks.confirm.mockReturnValue(0);
});
afterEach(() => vi.unstubAllEnvs());
describe("scheduled runtime protection", () => {
  it("keeps an idle supervised runtime awake and listening without offering Quit", () => {
    vi.stubEnv("CAPITALCOMBOT_SUPERVISED", "1");
    const { window, store } = setup([]);
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith("prevent-app-suspension");
    expect(mocks.menu.some((entry) => entry.label === "Quit Trading Assistant")).toBe(false);
    store.setSchedules([]);
    expect(mocks.stop).not.toHaveBeenCalled();
  });
  it("keeps an armed scheduler running when its window is closed", () => {
    const { window } = setup();
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith("prevent-app-suspension");
  });
  it("also protects auto-paused checks and in-flight orders", () => {
    setup([{ ...job, status: "paused", targetAutoPaused: true,
      targetPosition: { pairId: "pair", leg: "late", direction: "BUY", size: 0.78 } }]);
    expect(mocks.start).toHaveBeenCalledOnce();
    mocks.start.mockClear();
    setup([{ ...job, status: "executing" }]);
    expect(mocks.start).toHaveBeenCalledOnce();
  });
  it("releases sleep prevention when schedules are manually paused and reacquires it on resume", () => {
    const { store } = setup();
    store.setSchedules([{ ...job, status: "paused" }]);
    expect(mocks.stop).toHaveBeenCalledWith(0);
    store.setSchedules([job]);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });
  it("does not block window closure for only manually paused schedules", () => {
    const { window } = setup([{ ...job, status: "paused" }]);
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("minimizes instead of quitting if a tray cannot be created", () => {
    mocks.trayFails = true;
    const { window } = setup();
    window.emit("close", { preventDefault: vi.fn() });
    expect(window.minimize).toHaveBeenCalledOnce();
    expect(window.hide).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation to quit with pending schedules", () => {
    setup();
    const quit = mocks.menu.find((entry) => entry.label === "Quit Trading Assistant")!.click!;
    quit();
    expect(mocks.quit).not.toHaveBeenCalled();
    mocks.confirm.mockReturnValue(1);
    quit();
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
  it("allows an explicit app quit and cleans up the sleep blocker", () => {
    const { window } = setup();
    app.emit("before-quit");
    const event = { preventDefault: vi.fn() };
    window.emit("close", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    app.emit("will-quit");
    expect(mocks.stop).toHaveBeenCalledWith(0);
  });
  it("protects schedules created through patchState and exposes the window from the tray", () => {
    const { store, show } = setup([]);
    store.patchState({ schedules: [job] });
    expect(mocks.start).toHaveBeenCalledOnce();
    mocks.menu.find((entry) => entry.label === "Open Trading Assistant")!.click!();
    expect(show).toHaveBeenCalledOnce();
  });
});
