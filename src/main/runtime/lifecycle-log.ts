import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { redactSensitiveText } from "../security/redaction";

export function createLifecycleLog(directory: string) {
  const path = join(directory, "lifecycle.jsonl");
  return (event: string, detail?: string): void => {
    try {
      if (existsSync(path) && statSync(path).size > 1_048_576) {
        const previous = `${path}.1`;
        if (existsSync(previous)) unlinkSync(previous);
        renameSync(path, previous);
      }
      appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid,
        event, detail: redactSensitiveText(detail) })}\n`, { mode: 0o600 });
    } catch (error) {
      console.error("Unable to write lifecycle diagnostics", error);
    }
  };
}
