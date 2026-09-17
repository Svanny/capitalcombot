import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AppError } from "../../shared/types";
import type { ScheduledOrderJob, ScheduledTargetPositionUpdate } from "../../shared/types";
import type {
  CliConnectionInfo,
  CliMethod,
  CliRequest,
  CliResponse,
} from "../../shared/cli";
import { CLI_METHODS } from "../../shared/cli";
import { createIpcHandlers, type IpcDependencies } from "../ipc";

const MAX_REQUEST_BYTES = 1024 * 1024;
const LOOPBACK_HOST = "127.0.0.1" as const;

export interface CliServer {
  connection: CliConnectionInfo;
  runtimeFilePath: string;
  close(): Promise<void>;
}

export interface CliServerOptions {
  runtimeFilePath?: string;
}

export function getCliRuntimeFilePath(workspace = process.cwd()): string {
  if (process.env.CAPITALCOMBOT_CLI_FILE) {
    return resolve(process.env.CAPITALCOMBOT_CLI_FILE);
  }

  const workspaceHash = createHash("sha256")
    .update(resolve(workspace).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return resolve(tmpdir(), `capitalcombot-cli-${workspaceHash}.json`);
}

export async function executeCliRequest(
  dependencies: IpcDependencies,
  request: Pick<CliRequest, "method" | "input" | "confirmed">,
): Promise<unknown> {
  if (!CLI_METHODS.includes(request.method as CliMethod)) {
    throw new Error(
      JSON.stringify(cliError("UNKNOWN_CLI_METHOD", `Unknown CLI method: ${request.method}`, true)),
    );
  }

  const handlers = createIpcHandlers({
    ...dependencies,
    userPresence: {
      confirm: async () => request.confirmed === true,
    },
  });

  switch (request.method as CliMethod) {
    case "app.bootstrap":
      return handlers.bootstrap();
    case "auth.connect":
      return handlers.connect(request.input);
    case "auth.connectSaved": {
      const { credentials: _credentials, ...safeResponse } = await handlers.connectSaved();
      return safeResponse;
    }
    case "auth.disconnect":
      return handlers.disconnect();
    case "auth.forgetSaved":
      return handlers.forgetSaved();
    case "markets.searchGold":
      return handlers.searchGold(request.input);
    case "markets.select":
      return handlers.selectMarket(request.input);
    case "quotes.getSelected":
      return handlers.getSelectedQuote();
    case "positions.listOpen":
      return handlers.listPositions();
    case "positions.close":
      return handlers.closePosition(request.input);
    case "positions.reverse":
      return handlers.reversePosition(request.input);
    case "positions.updateProtection":
      return handlers.updatePositionProtection(request.input);
    case "orders.openMarket":
      return handlers.openMarket(request.input);
    case "orders.previewProtection":
      return handlers.previewProtection(request.input);
    case "schedules.list":
      return handlers.listSchedules();
    case "schedules.cancel":
      return handlers.cancelSchedule(request.input);
    case "schedules.pause":
      return handlers.pauseSchedule(request.input);
    case "schedules.reactivate":
      return handlers.reactivateSchedule(request.input);
    case "schedules.update":
      return handlers.updateSchedule(request.input);
    case "targetPosition.update": {
      requireCliConfirmation(request.confirmed);
      const { jobId, targetPosition } = validateTargetPositionInput(request.input);
      const job = (await handlers.listSchedules()).find((candidate) => candidate.id === jobId);
      if (!job) {
        throw new Error(JSON.stringify(cliError(
          "MISSING_SCHEDULE",
          "No scheduled order was found to update.",
          true,
        )));
      }
      return handlers.updateSchedule({
        jobId,
        direction: job.direction,
        size: job.size,
        schedule: scheduleRequestFor(job),
        protection: job.protection ?? null,
        targetPosition,
      });
    }
  }
}

function requireCliConfirmation(confirmed: boolean | undefined): void {
  if (confirmed !== true) {
    throw new Error(JSON.stringify(cliError(
      "USER_PRESENCE_REQUIRED",
      "Confirm the Capital.com action to continue.",
      true,
    )));
  }
}

function validateTargetPositionInput(input: unknown): {
  jobId: string;
  targetPosition: ScheduledTargetPositionUpdate;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidTargetPositionInput();
  }
  const { jobId, targetPosition } = input as Record<string, unknown>;
  if (typeof jobId !== "string" || !jobId.trim() || !targetPosition ||
    typeof targetPosition !== "object" || Array.isArray(targetPosition)) {
    throw invalidTargetPositionInput();
  }
  const update = targetPosition as Record<string, unknown>;
  if (update.enabled === false) {
    return { jobId: jobId.trim(), targetPosition: { enabled: false } };
  }
  if (update.enabled !== true || (update.direction !== "BUY" && update.direction !== "SELL") ||
    typeof update.size !== "number" || !Number.isFinite(update.size) || update.size <= 0) {
    throw invalidTargetPositionInput();
  }
  return {
    jobId: jobId.trim(),
    targetPosition: { enabled: true, direction: update.direction, size: update.size },
  };
}

function invalidTargetPositionInput(): Error {
  return new Error(JSON.stringify(cliError(
    "INVALID_INPUT",
    "Enter a valid target-position update.",
    true,
  )));
}

function scheduleRequestFor(job: ScheduledOrderJob): { type: "repeating"; runTime: string } |
  { type: "one-off"; runAt: string } {
  return job.scheduleType === "repeating"
    ? { type: "repeating", runTime: job.runTime ?? "" }
    : { type: "one-off", runAt: job.runAt };
}

export async function startCliServer(
  dependencies: IpcDependencies,
  options: CliServerOptions = {},
): Promise<CliServer> {
  const token = randomBytes(32).toString("hex");
  const runtimeFilePath = options.runtimeFilePath ?? getCliRuntimeFilePath();
  const server = createServer((socket) => handleConnection(socket, token, dependencies));

  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The CLI server did not receive a TCP address.");
  }

  const connection: CliConnectionInfo = {
    version: 1,
    host: LOOPBACK_HOST,
    port: address.port,
    token,
    pid: process.pid,
  };

  try {
    await writeFile(runtimeFilePath, `${JSON.stringify(connection)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (process.platform !== "win32") {
      await chmod(runtimeFilePath, 0o600);
    }
  } catch (error) {
    await closeServer(server);
    throw error;
  }

  let closed = false;
  return {
    connection,
    runtimeFilePath,
    close: async () => {
      if (closed) return;
      closed = true;
      removeOwnedRuntimeFile(runtimeFilePath, token);
      await closeServer(server);
    },
  };
}

function handleConnection(socket: Socket, token: string, dependencies: IpcDependencies): void {
  socket.setEncoding("utf8");
  socket.setTimeout(30_000, () => socket.destroy());
  socket.on("error", () => undefined);

  let payload = "";
  let handled = false;
  socket.on("data", (chunk: string) => {
    if (handled) return;
    payload += chunk;
    if (Buffer.byteLength(payload, "utf8") > MAX_REQUEST_BYTES) {
      handled = true;
      sendResponse(socket, failure("unknown", "CLI_REQUEST_TOO_LARGE", "CLI request is too large."));
      return;
    }

    const newline = payload.indexOf("\n");
    if (newline === -1) return;

    handled = true;
    const line = payload.slice(0, newline);
    payload = "";
    void processLine(line, token, dependencies).then((response) => sendResponse(socket, response));
  });
}

async function processLine(
  line: string,
  token: string,
  dependencies: IpcDependencies,
): Promise<CliResponse> {
  let request: CliRequest;
  try {
    request = JSON.parse(line) as CliRequest;
  } catch {
    return failure("unknown", "INVALID_CLI_REQUEST", "CLI request must be valid JSON.");
  }

  const id = typeof request.id === "string" ? request.id : "unknown";
  if (!secureTokenEqual(request.token, token)) {
    return failure(id, "CLI_UNAUTHORIZED", "CLI authentication failed.");
  }

  try {
    return {
      id,
      ok: true,
      result: await executeCliRequest(dependencies, request),
    };
  } catch (error) {
    const normalized = parseHandlerError(error);
    return { id, ok: false, error: normalized };
  }
}

function secureTokenEqual(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function parseHandlerError(error: unknown): AppError {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as AppError;
      if (parsed && typeof parsed.code === "string" && typeof parsed.message === "string") {
        return parsed;
      }
    } catch {
      return cliError("UNEXPECTED_ERROR", error.message, false);
    }
  }

  return cliError("UNEXPECTED_ERROR", "An unexpected application error occurred.", false);
}

function cliError(code: string, message: string, recoverable: boolean): AppError {
  return { code, message, recoverable };
}

function failure(id: string, code: string, message: string): CliResponse {
  return { id, ok: false, error: cliError(code, message, true) };
}

function sendResponse(socket: Socket, response: CliResponse): void {
  if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off("error", onError);
      resolvePromise();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!server.listening) {
      resolvePromise();
      return;
    }
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

function removeOwnedRuntimeFile(runtimeFilePath: string, token: string): void {
  try {
    if (!existsSync(runtimeFilePath)) return;
    const current = JSON.parse(readFileSync(runtimeFilePath, "utf8")) as Partial<CliConnectionInfo>;
    if (current.token === token) unlinkSync(runtimeFilePath);
  } catch {
    // A later process may have replaced or removed the discovery file.
  }
}
