import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export function getRuntimeFilePath(workspace = process.cwd(), environment = process.env) {
  if (environment.CAPITALCOMBOT_CLI_FILE) return resolve(environment.CAPITALCOMBOT_CLI_FILE);
  const workspaceHash = createHash("sha256")
    .update(resolve(workspace).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return resolve(tmpdir(), `capitalcombot-cli-${workspaceHash}.json`);
}

export async function callRunningApp({ method, input, confirmed }) {
  const runtimeFilePath = getRuntimeFilePath();
  let connection;
  try {
    connection = JSON.parse(await readFile(runtimeFilePath, "utf8"));
  } catch {
    throw new Error("No running Capital.com Trading Assistant was found. Start it with 'pnpm dev' first.");
  }

  if (
    connection?.version !== 1 ||
    connection?.host !== "127.0.0.1" ||
    !Number.isInteger(connection?.port) ||
    typeof connection?.token !== "string"
  ) {
    throw new Error(`Invalid CLI connection file: ${runtimeFilePath}`);
  }

  const request = {
    id: randomUUID(),
    token: connection.token,
    method,
    ...(input === undefined ? {} : { input }),
    confirmed,
  };
  return sendRequest(connection, request);
}

function sendRequest(connection, request) {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection({ host: connection.host, port: connection.port });
    let settled = false;
    let payload = "";

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback();
    };

    socket.setEncoding("utf8");
    socket.setTimeout(30_000, () => finish(() => reject(new Error("The running app did not respond within 30 seconds."))));
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      payload += chunk;
      if (Buffer.byteLength(payload, "utf8") > MAX_RESPONSE_BYTES) {
        finish(() => reject(new Error("The app returned an unexpectedly large response.")));
        return;
      }
      const newline = payload.indexOf("\n");
      if (newline === -1) return;

      finish(() => {
        try {
          const response = JSON.parse(payload.slice(0, newline));
          if (response.id !== request.id) throw new Error("The app returned a mismatched response.");
          if (!response.ok) {
            const error = new Error(response.error?.message ?? "The command failed.");
            error.code = response.error?.code;
            error.detail = response.error?.detail;
            reject(error);
            return;
          }
          resolvePromise(response.result);
        } catch (error) {
          reject(error);
        }
      });
    });
    socket.once("error", (error) =>
      finish(() => reject(new Error(`Could not reach the running app: ${error.message}`))),
    );
  });
}
