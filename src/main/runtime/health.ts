import { writeFileSync } from "node:fs";

// A separate process watches this heartbeat, so a blocked main event loop cannot
// report itself healthy. No broker credentials or CLI token enter this file.
export function startRuntimeHeartbeat(path: string | undefined, connected: () => boolean, listening = () => true) {
  if (!path) return () => {};
  const beat = () => {
    if (!listening()) throw new Error("CLI listener stopped; restarting the runtime is required.");
    writeFileSync(path, JSON.stringify({
      pid: process.pid, at: new Date().toISOString(), connected: connected(),
    }), { mode: 0o600 });
  };
  beat();
  const timer = setInterval(beat, 10_000);
  timer.unref();
  return () => clearInterval(timer);
}

export function startConnectionMaintenance(
  connect: () => Promise<void>,
  log: (event: string, detail?: string) => void,
) {
  let pending = false;
  let stopped = false;
  let previous: boolean | undefined;
  const check = async () => {
    if (pending || stopped) return;
    pending = true;
    try {
      await connect();
      if (previous !== true) log("broker-connection-ready");
      previous = true;
    } catch (error) {
      const detail = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
      if (previous !== false) log("broker-connection-unavailable", detail);
      previous = false;
    } finally { pending = false; }
  };
  void check();
  const timer = setInterval(() => void check(), 60_000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
