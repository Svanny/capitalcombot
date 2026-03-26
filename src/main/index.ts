import { BrowserWindow, app, nativeImage } from "electron";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CapitalClient } from "./capital/client";
import { registerIpcHandlers } from "./ipc";
import { ElectronAppStateStore, buildExecutionResult } from "./services/app-store";
import { createCredentialStore } from "./services/credential-store";
import { resolveProtection } from "./services/protection";
import { ScheduledOrderScheduler } from "./services/scheduler";

const store = new ElectronAppStateStore();
const client = new CapitalClient();
const currentDir = fileURLToPath(new URL(".", import.meta.url));
const iconPath = join(currentDir, "../../gold_die_logo.png");
const appIcon = nativeImage.createFromPath(iconPath);
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
      sandbox: false,
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

  const credentials = await createCredentialStore();

  if (credentials.warning) {
    store.appendExecution(buildExecutionResult("auth", "info", credentials.warning));
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
