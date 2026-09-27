import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callRunningApp } from "./client.mjs";

const cleanups = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function mockApp(respond) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let payload = "";
    socket.on("data", (data) => {
      payload += data;
      if (payload.includes("\n")) respond(socket, JSON.parse(payload.split("\n")[0]));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => {
    for (const socket of sockets) socket.destroy();
    server.close(resolve);
  }));
  const directory = await mkdtemp(join(tmpdir(), "capitalcombot-client-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "connection.json");
  await writeFile(path, JSON.stringify({ version: 1, host: "127.0.0.1", port: server.address().port, token: "test-token" }));
  vi.stubEnv("CAPITALCOMBOT_CLI_FILE", path);
}

describe("CLI transport", () => {
  it("runs the real CLI and emits compact JSON", async () => {
    await mockApp((socket, request) => socket.end(`${JSON.stringify({ id: request.id, ok: true, result: { connected: false } })}\n`));
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ["scripts/cli.mjs", "status", "--compact"], { timeout: 2000 });
    expect(stdout).toBe('{"connected":false}\n');
    expect(stderr).toBe("");
  });

  it.each([
    ["positions", "close", "deal"],
    ["positions", "close", "deal", "--yes=false"],
    ["orders", "open", "GOLD", "--direction", "BUY", "--size", "1", "--schedul", "{}", "--yes"],
  ])("rejects unsafe CLI invocation without contacting the app: %j", async (...args) => {
    const called = vi.fn();
    await mockApp((socket) => { called(); socket.end(); });
    await expect(promisify(execFile)(process.execPath, ["scripts/cli.mjs", ...args], { timeout: 2000 }))
      .rejects.toMatchObject({ code: 1, stdout: "" });
    expect(called).not.toHaveBeenCalled();
  });

  it.each(["", '{"id":'])("rejects a closed connection with an incomplete response %j", async (payload) => {
    await mockApp((socket) => socket.end(payload));
    await expect(callRunningApp({ method: "app.bootstrap" })).rejects.toThrow("before returning a complete response");
  }, 1000);

  it.each([{}, { ok: "true", result: "wrong" }, { ok: false }, { ok: false, error: { message: 42 } }])(
    "rejects malformed response envelopes %j", async (payload) => {
      await mockApp((socket, request) => socket.end(`${JSON.stringify({ ...payload, id: request.id })}\n`));
      await expect(callRunningApp({ method: "app.bootstrap" })).rejects.toThrow("invalid response");
    },
  );

  it("decodes fragmented UTF-8 responses", async () => {
    await mockApp((socket, request) => {
      const response = Buffer.from(`${JSON.stringify({ id: request.id, ok: true, result: "ทอง" })}\n`);
      for (const byte of response) socket.write(Buffer.from([byte]));
      socket.end();
    });
    await expect(callRunningApp({ method: "app.bootstrap" })).resolves.toBe("ทอง");
  });
});
