import { app, dialog, Menu, powerSaveBlocker, Tray, type BrowserWindow, type NativeImage } from "electron";
import type { AppStateStore } from "../state/app-store";
import { canCheckSchedule } from "../../shared/target-pause";

// Keep protection tied to the same state writes used by the scheduler and CLI.
export function protectScheduleRuntime(
  original: AppStateStore,
  icon: NativeImage,
  showWindow: () => void,
  log: (event: string, detail?: string) => void,
) {
  let quitting = false;
  let blocker: number | undefined;
  let tray: Tray | undefined;
  const alwaysOn = process.env.CAPITALCOMBOT_SUPERVISED === "1";
  const hasWork = () => original.getState().schedules.some(
    (job) => canCheckSchedule(job) || job.status === "executing",
  );
  const sync = () => {
    if ((alwaysOn || hasWork()) && blocker === undefined) {
      blocker = powerSaveBlocker.start("prevent-app-suspension");
      log("sleep-prevention-started");
    } else if (!alwaysOn && !hasWork() && blocker !== undefined) {
      powerSaveBlocker.stop(blocker);
      blocker = undefined;
      log("sleep-prevention-stopped");
    }
  };
  const quit = () => {
    if (hasWork() && dialog.showMessageBoxSync({
      type: "warning", title: "Stop scheduled trading?",
      message: "Quitting stops all scheduled trading until the app is started again.",
      buttons: ["Keep running", "Quit and stop schedules"], defaultId: 0, cancelId: 0,
    }) !== 1) return;
    log("quit-requested-from-tray");
    app.quit();
  };
  try {
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip("Capital.com Trading Assistant — scheduler running");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Trading Assistant", click: showWindow },
      { type: "separator" },
      ...(alwaysOn ? [{ label: "Always-on scheduler active", enabled: false }]
        : [{ label: "Quit Trading Assistant", click: quit }]),
    ]));
    tray.on("double-click", showWindow);
  } catch (error) {
    log("tray-unavailable", String(error));
  }
  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", () => {
    if (blocker !== undefined) powerSaveBlocker.stop(blocker);
    tray?.destroy();
  });
  sync();
  return {
    store: {
      getState: () => original.getState(),
      appendExecution: (result) => original.appendExecution(result),
      patchState: (partial) => { original.patchState(partial); sync(); },
      setSchedules: (schedules) => { original.setSchedules(schedules); sync(); },
    } satisfies AppStateStore,
    attachWindow(window: BrowserWindow) {
      window.on("close", (event) => {
        log("window-close-requested", `pendingSchedules=${hasWork()}; quitting=${quitting}`);
        if (!quitting && (alwaysOn || hasWork())) {
          event.preventDefault();
          if (tray) window.hide();
          else window.minimize();
          log("scheduler-kept-running-in-background");
        }
      });
    },
  };
}
