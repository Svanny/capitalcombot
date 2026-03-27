import { BrowserWindow, app, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CapitalClient } from "./trading/capital/client";
import { registerIpcHandlers } from "./ipc";
import { createCredentialStore } from "./security/credential-store";
import { buildExecutionResult, createAppStateStore } from "./state/app-store";
import { resolveProtection } from "./trading/protection";
import { ScheduledOrderScheduler } from "./trading/scheduler";

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

  scheduler.restore();
  await registerIpcHandlers({
    client,
    store,
    credentials: credentials.store,
    scheduler,
  });
  createMainWindow();

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
