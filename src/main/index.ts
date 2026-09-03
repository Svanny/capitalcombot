import { BrowserWindow, app, dialog, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CapitalClient } from "./trading/capital/client";
import { registerIpcHandlers } from "./ipc";
import { createCredentialStore } from "./security/credential-store";
import { buildExecutionResult, createAppStateStore } from "./state/app-store";
import { resolveProtection } from "./trading/protection";
import { ScheduledOrderScheduler } from "./trading/scheduler";
import { executeTargetPositionJob } from "./trading/target-position-execution";

const client = new CapitalClient();
const currentDir = fileURLToPath(new URL(".", import.meta.url));
const iconPath = join(currentDir, "../../gold_die_logo.png");
const appIcon = nativeImage.createFromPath(iconPath);

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#091215",
    icon: appIcon.isEmpty() ? undefined : appIcon,
    title: "Capital.com Trading Assistant",
    webPreferences: {
      preload: join(currentDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform !== "darwin") {
    window.setMenuBarVisibility(false);
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(currentDir, "../renderer/index.html"));
  }

  return window;
}

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon);
  }

  const appStateBootstrap = await createAppStateStore();
  const store = appStateBootstrap.store;
  const credentials = await createCredentialStore();
  const scheduler = new ScheduledOrderScheduler(store, async (job) => {
    if (job.targetPosition) {
      return executeTargetPositionJob(client, job);
    }

    const resolvedProtection = job.protection
      ? await resolveProtection(client, {
          epic: job.epic,
          direction: job.direction,
          protection: job.protection,
        })
      : null;

    const position = await client.openMarketPosition(
      {
        epic: job.epic,
        direction: job.direction,
        size: job.size,
        protection: job.protection ?? null,
      },
      resolvedProtection,
    );

    return {
      position,
      resolvedProtection,
    };
  });

  if (credentials.warning) {
    store.appendExecution(buildExecutionResult("auth", "info", credentials.warning));
  }

  if (appStateBootstrap.warning) {
    store.appendExecution(buildExecutionResult("auth", "info", appStateBootstrap.warning));
  }

  await registerIpcHandlers({
    client,
    store,
    credentials: credentials.store,
    scheduler,
  });
  const window = createMainWindow();
  const restoredSchedules = scheduler.restore({ armScheduled: false });
  const restoredPendingSchedules = restoredSchedules.filter((job) => job.status === "scheduled");

  if (restoredPendingSchedules.length > 0) {
    const response = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["Arm schedules", "Cancel restored schedules"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "Review restored scheduled orders",
      message: "Review restored scheduled orders",
      detail:
        `${restoredPendingSchedules.length} pending scheduled order(s) were restored from local state. ` +
        "Arm them only if they still match your current trading intent.",
    });

    if (response.response === 0) {
      scheduler.armScheduledJobs();
      store.appendExecution(
        buildExecutionResult(
          "schedule",
          "info",
          "Restored scheduled orders were armed after startup confirmation.",
        ),
      );
    } else {
      restoredPendingSchedules.forEach((job) => {
        scheduler.cancel(job.id, "Cancelled during startup restore review.");
      });
      store.appendExecution(
        buildExecutionResult(
          "schedule",
          "info",
          "Restored scheduled orders were cancelled during startup review.",
        ),
      );
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
