import { BrowserWindow, app, nativeImage, powerMonitor } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CapitalClient } from "./trading/capital/client";
import { registerIpcHandlers } from "./ipc";
import { createCredentialStore } from "./security/credential-store";
import { buildExecutionResult, createAppStateStore } from "./state/app-store";
import { resolveProtection } from "./trading/protection";
import { ScheduledOrderScheduler } from "./trading/scheduler";
import { executeTargetPositionJob } from "./trading/target-position-execution";
import { startCliServer, type CliServer } from "./cli/server";
import { IPC_CHANNELS } from "../shared/ipc";
import { createLifecycleLog } from "./runtime/lifecycle-log";
import { protectScheduleRuntime } from "./runtime/schedule-runtime";
import { startConnectionMaintenance, startRuntimeHeartbeat } from "./runtime/health";

// Vite serves fresh assets locally; avoid reopening a stale or locked Chromium
// HTTP disk cache across development restarts. Set this before app readiness.
if (process.env.ELECTRON_RENDERER_URL) {
  app.commandLine.appendSwitch("disable-http-cache");
}

const client = new CapitalClient();
const currentDir = fileURLToPath(new URL(".", import.meta.url));
const iconPath = join(currentDir, "../../gold_die_logo.png");
const appIcon = nativeImage.createFromPath(iconPath);
let cliServer: CliServer | null = null;
let runtime: ReturnType<typeof protectScheduleRuntime> | undefined;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

function showMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) { createMainWindow(); return; }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
app.on("second-instance", showMainWindow);

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
  runtime?.attachWindow(window);

  if (process.platform !== "darwin") {
    window.setMenuBarVisibility(false);
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    window.maximize();
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(currentDir, "../renderer/index.html"));
  }

  return window;
}

if (ownsInstance) app.whenReady().then(async () => {
  const log = createLifecycleLog(app.getPath("userData"));
  log("started", `version=${app.getVersion()}; supervised=${process.env.CAPITALCOMBOT_SUPERVISED === "1"}`);
  app.on("before-quit", () => log("before-quit"));
  app.on("will-quit", () => log("will-quit"));
  app.on("render-process-gone", (_event, _contents, detail) => log("renderer-gone", JSON.stringify(detail)));
  app.on("child-process-gone", (_event, detail) => log("child-process-gone", JSON.stringify(detail)));
  process.on("uncaughtException", (error) => {
    log("uncaught-exception", error.stack);
    app.exit(1);
  });
  process.on("unhandledRejection", (error) => {
    log("unhandled-rejection", error instanceof Error ? error.stack : String(error));
    app.exit(1);
  });
  powerMonitor.on("suspend", () => log("suspend"));
  powerMonitor.on("resume", () => log("resume"));
  powerMonitor.on("shutdown", () => log("shutdown"));
  if (process.platform === "darwin" && app.dock && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon);
  }

  const appStateBootstrap = await createAppStateStore();
  runtime = protectScheduleRuntime(appStateBootstrap.store, appIcon, showMainWindow, log);
  const store = runtime.store;
  const credentials = await createCredentialStore();
  const scheduler = new ScheduledOrderScheduler(store, async (job) => {
    // A schedule may fire after startup, after the REST session's ten-minute
    // idle window, or before the user has opened the saved-session prompt.
    // Restore the saved account just in time for the broker request.
    if (!client.isConnected()) {
      await client.ensureConnected(await credentials.store.load());
    }

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

  const dependencies = {
    client,
    store,
    credentials: credentials.store,
    scheduler,
  };
  await registerIpcHandlers(dependencies);
  cliServer = await startCliServer(dependencies, {
    onStateChanged: () => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.APP_STATE_CHANGED);
        }
      }
    },
  });
  createMainWindow();
  const restoredSchedules = scheduler.restore();
  const restoredPendingSchedules = restoredSchedules.filter((job) => job.status === "scheduled" || job.targetAutoPaused);
  log("schedules-restored", `count=${restoredPendingSchedules.length}`);
  const stopHeartbeat = startRuntimeHeartbeat(process.env.CAPITALCOMBOT_HEARTBEAT_FILE,
    () => client.isConnected(), () => cliServer?.isListening() === true);
  const stopConnection = process.env.CAPITALCOMBOT_SUPERVISED === "1"
    ? startConnectionMaintenance(async () => {
        await client.ensureConnected(await credentials.store.load());
        // A read-only request verifies the broker session and network, rather
        // than just trusting the local token expiry.
        await client.getAccountPreferences();
      }, log) : () => {};
  app.once("will-quit", () => { stopHeartbeat(); stopConnection(); });

  if (restoredPendingSchedules.length > 0) {
    store.appendExecution(
      buildExecutionResult(
        "schedule",
        "info",
        "Restored scheduled orders were armed automatically at startup.",
      ),
    );
  }

  app.on("activate", () => {
    showMainWindow();
  });
}).catch((error) => {
  createLifecycleLog(app.getPath("userData"))("startup-failed", error instanceof Error ? error.stack : String(error));
  app.exit(1);
});

app.once("before-quit", () => {
  void cliServer?.close();
  cliServer = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
