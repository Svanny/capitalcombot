import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryCredentialStore } from "../security/credential-store";
import { MemoryAppStateStore } from "../state/app-store";
import type { IpcDependencies, SchedulerLike, TradingClientLike } from "../ipc";
import type { CliResponse } from "../../shared/cli";
import type { ScheduledOrderJob } from "../../shared/types";
import { executeCliRequest, startCliServer, type CliServer } from "./server";

const activeServers: CliServer[] = [];
const directories: string[] = [];

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "capitalcombot-cli-test-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function createDependencies(): IpcDependencies {
  const client: TradingClientLike = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    isConnected: vi.fn(() => false),
    searchGoldMarkets: vi.fn(async () => []),
    getMarketDetails: vi.fn(async () => {
      throw new Error("not used");
    }),
    getQuote: vi.fn(async () => {
      throw new Error("not used");
    }),
    getHistoricalPrices: vi.fn(async () => []),
    listPositions: vi.fn(async () => []),
    getAccountPreferences: vi.fn(async () => ({ hedgingMode: false })),
    openMarketPosition: vi.fn(async () => null),
    closePosition: vi.fn(async () => undefined),
    reversePosition: vi.fn(async () => null),
    updatePositionProtection: vi.fn(async () => null),
  };
  const scheduler: SchedulerLike = {
    list: vi.fn(() => []),
    schedule: vi.fn(() => {
      throw new Error("not used");
    }),
    cancel: vi.fn(() => []),
    pause: vi.fn(() => []),
    reactivate: vi.fn(() => {
      throw new Error("not used");
    }),
    update: vi.fn(() => {
      throw new Error("not used");
    }),
  };
  return {
    client,
    scheduler,
    store: new MemoryAppStateStore(),
    credentials: new MemoryCredentialStore(),
  };
}

describe("CLI server", () => {
  it.each([
    ["{", "INVALID_CLI_REQUEST"],
    ["x".repeat(1024 * 1024 + 1), "CLI_REQUEST_TOO_LARGE"],
  ])("contains malformed and oversized wire requests %#", async (line, code) => {
    const directory = await testDirectory();
    const server = await startCliServer(createDependencies(), { runtimeFilePath: join(directory, "connection.json") });
    activeServers.push(server);
    expect(await sendLine(server, line)).toMatchObject({ ok: false, error: { code } });
    expect(await send(server, { id: "healthy", token: server.connection.token, method: "app.bootstrap" })).toMatchObject({ ok: true });
  });
  it("does not report a completed trade as failed if GUI notification throws", async () => {
    const dependencies = createDependencies();
    await expect(executeCliRequest(dependencies, { method: "positions.close", input: { dealId: "deal-1" }, confirmed: true },
      () => { throw new Error("Window closed"); })).resolves.toMatchObject({ result: { status: "success" } });
    expect(dependencies.client.closePosition).toHaveBeenCalledTimes(1);
  });

  it("closes idle client sockets when shutting down", async () => {
    const directory = await testDirectory();
    const server = await startCliServer(createDependencies(), { runtimeFilePath: join(directory, "connection.json") });
    activeServers.push(server);
    const socket = createConnection({ host: server.connection.host, port: server.connection.port });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    await server.close();
    await closed;
    await expect(readFile(server.runtimeFilePath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 1000);

  it.each([{ confirmed: "true" }, { id: "" }, { method: {} }])("rejects invalid authenticated fields %j", async (fields) => {
    const directory = await testDirectory();
    const server = await startCliServer(createDependencies(), { runtimeFilePath: join(directory, "connection.json") });
    activeServers.push(server);
    expect(await send(server, { id: "shape", token: server.connection.token, method: "app.bootstrap", ...fields }))
      .toMatchObject({ ok: false, error: { code: "INVALID_CLI_REQUEST" } });
  });
  it("requires confirmation for raw schedule updates containing target settings", async () => {
    const dependencies = createDependencies();
    await expect(executeCliRequest(dependencies, {
      method: "schedules.update", confirmed: false,
      input: { jobId: "job", direction: "BUY", size: 1,
        schedule: { type: "repeating", runTime: "09:30" }, targetPosition: { enabled: false } },
    })).rejects.toThrow("USER_PRESENCE_REQUIRED");
    expect(dependencies.scheduler.update).not.toHaveBeenCalled();
  });

  it.each([null, [], true, 1, "request"].map((request) => ({ request })))("rejects non-object request $request without killing the server", async ({ request }) => {
    const directory = await testDirectory();
    const server = await startCliServer(createDependencies(), { runtimeFilePath: join(directory, "connection.json") });
    activeServers.push(server);
    expect(await send(server, request)).toMatchObject({ ok: false, error: { code: "INVALID_CLI_REQUEST" } });
    expect(await send(server, { id: "next", token: server.connection.token, method: "app.bootstrap" })).toMatchObject({ ok: true });
  });

  it("rejects a Unicode token with the same character count", async () => {
    const directory = await testDirectory();
    const server = await startCliServer(createDependencies(), { runtimeFilePath: join(directory, "connection.json") });
    activeServers.push(server);
    expect(await send(server, { id: "unicode", token: "é".repeat(64), method: "app.bootstrap" }))
      .toMatchObject({ ok: false, error: { code: "CLI_UNAUTHORIZED" } });
  });
  it("notifies the GUI after mutations, including commands that fail after changing state", async () => {
    const dependencies = createDependencies();
    const directory = await testDirectory();
    const onStateChanged = vi.fn();
    const server = await startCliServer(dependencies, {
      runtimeFilePath: join(directory, "connection.json"), onStateChanged,
    });
    activeServers.push(server);
    const request = { id: "sync", token: server.connection.token, method: "auth.disconnect" };
    expect(await send(server, request)).toMatchObject({ ok: true });
    expect(onStateChanged).toHaveBeenCalledTimes(1);
    await send(server, { ...request, method: "app.bootstrap" });
    await send(server, { ...request, token: "invalid" });
    expect(onStateChanged).toHaveBeenCalledTimes(1);
    vi.mocked(dependencies.client.disconnect).mockRejectedValueOnce(new Error("disconnect failed"));
    expect(await send(server, request)).toMatchObject({ ok: false });
    expect(onStateChanged).toHaveBeenCalledTimes(2);
  });

  it("routes commands through the existing validated handlers", async () => {
    const dependencies = createDependencies();
    const state = await executeCliRequest(dependencies, { method: "app.bootstrap" });

    expect(state).toMatchObject({ connected: false, schedules: [] });
  });

  it("requires explicit CLI confirmation for high-risk actions", async () => {
    const dependencies = createDependencies();

    await expect(
      executeCliRequest(dependencies, {
        method: "positions.close",
        input: { dealId: "deal-1" },
        confirmed: false,
      }),
    ).rejects.toThrow("USER_PRESENCE_REQUIRED");
    expect(dependencies.client.closePosition).not.toHaveBeenCalled();

    await executeCliRequest(dependencies, {
      method: "positions.close",
      input: { dealId: "deal-1" },
      confirmed: true,
    });
    expect(dependencies.client.closePosition).toHaveBeenCalledWith("deal-1");
  });

  it("updates target-position mode without requiring callers to repeat schedule fields", async () => {
    const dependencies = createDependencies();
    const job: ScheduledOrderJob = {
      id: "schedule-early",
      epic: "GOLD",
      instrumentName: "Gold",
      direction: "SELL",
      size: 0.5,
      scheduleType: "repeating",
      runAt: "2026-09-18T02:30:00.000Z",
      runTime: "09:30",
      status: "scheduled",
      createdAt: "2026-09-17T00:00:00.000Z",
      protection: null,
    };
    vi.mocked(dependencies.scheduler.list).mockReturnValue([job]);
    vi.mocked(dependencies.scheduler.update).mockReturnValue(job);

    const input = {
      jobId: job.id,
      targetPosition: { enabled: true, direction: "BUY", size: 1.25 },
    };
    await expect(executeCliRequest(dependencies, {
      method: "targetPosition.update",
      input,
      confirmed: false,
    })).rejects.toThrow("USER_PRESENCE_REQUIRED");

    await executeCliRequest(dependencies, {
      method: "targetPosition.update",
      input,
      confirmed: true,
    });

    expect(dependencies.scheduler.update).toHaveBeenCalledWith(job.id, {
      direction: job.direction,
      size: job.size,
      type: "repeating",
      runTime: job.runTime,
      protection: null,
      targetPosition: { enabled: true, direction: "BUY", size: 1.25 },
      targetCurrentPosition: 0,
    });
  });

  it("does not return saved credential secrets", async () => {
    const dependencies = createDependencies();
    await dependencies.credentials.save({
      identifier: "account-id",
      password: "secret-password",
      apiKey: "secret-api-key",
      environment: "demo",
    });

    const response = await executeCliRequest(dependencies, {
      method: "auth.connectSaved",
      confirmed: true,
    });

    expect(response).not.toHaveProperty("credentials");
    expect(JSON.stringify(response)).not.toContain("secret-password");
    expect(JSON.stringify(response)).not.toContain("secret-api-key");
  });

  it("accepts authenticated loopback requests and rejects a bad token", async () => {
    const directory = await testDirectory();
    const runtimeFilePath = join(directory, "connection.json");
    const server = await startCliServer(createDependencies(), { runtimeFilePath });
    activeServers.push(server);

    expect(JSON.parse(await readFile(runtimeFilePath, "utf8"))).toEqual(server.connection);

    const success = await send(server, {
      id: "request-1",
      token: server.connection.token,
      method: "app.bootstrap",
    });
    expect(success).toMatchObject({ id: "request-1", ok: true });

    const rejected = await send(server, {
      id: "request-2",
      token: "x".repeat(server.connection.token.length),
      method: "app.bootstrap",
    });
    expect(rejected).toMatchObject({
      id: "request-2",
      ok: false,
      error: { code: "CLI_UNAUTHORIZED" },
    });
  });
});

function send(server: CliServer, request: unknown): Promise<CliResponse> {
  return sendLine(server, JSON.stringify(request));
}

function sendLine(server: CliServer, line: string): Promise<CliResponse> {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection({
      host: server.connection.host,
      port: server.connection.port,
    });
    let payload = "";
    socket.setTimeout(500, () => { socket.destroy(); reject(new Error("No CLI response")); });
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${line}\n`));
    socket.on("data", (chunk) => {
      payload += chunk;
      const newline = payload.indexOf("\n");
      if (newline !== -1) resolvePromise(JSON.parse(payload.slice(0, newline)) as CliResponse);
    });
    socket.once("error", reject);
  });
}
