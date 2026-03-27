import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { loadKeytarModule, type KeytarModuleLike } from "./credential-store";

const STATE_INTEGRITY_SERVICE = "capitalcombot.state";
const STATE_INTEGRITY_ACCOUNT = "integrity-key";

export interface StateIntegrityProtector {
  sign(payload: unknown): string;
  verify(payload: unknown, signature: string): boolean;
}

export interface StateIntegrityBootstrap {
  backend: "keytar" | "memory";
  protector: StateIntegrityProtector;
  warning?: string;
}

export async function createStateIntegrityProtector(options?: {
  loadKeytar?: () => Promise<KeytarModuleLike>;
}): Promise<StateIntegrityBootstrap> {
  const loadKeytar = options?.loadKeytar ?? loadKeytarModule;

  try {
    const keytar = await loadKeytar();
    const secret = await loadOrCreateSecret(keytar);

    return {
      backend: "keytar",
      protector: new HmacStateIntegrityProtector(secret),
    };
  } catch {
    return {
      backend: "memory",
      protector: new HmacStateIntegrityProtector(randomBytes(32).toString("hex")),
      warning:
        "Secure persisted app state is unavailable. Schedules and execution history will only be kept until the app closes.",
    };
  }
}

async function loadOrCreateSecret(keytar: KeytarModuleLike): Promise<string> {
  const existing = await keytar.getPassword(STATE_INTEGRITY_SERVICE, STATE_INTEGRITY_ACCOUNT);

  if (existing) {
    return existing;
  }

  const secret = randomBytes(32).toString("hex");
  await keytar.setPassword(STATE_INTEGRITY_SERVICE, STATE_INTEGRITY_ACCOUNT, secret);
  return secret;
}

class HmacStateIntegrityProtector implements StateIntegrityProtector {
  constructor(private readonly secret: string) {}

  sign(payload: unknown): string {
    return createHmac("sha256", this.secret).update(stableStringify(payload)).digest("hex");
  }

  verify(payload: unknown, signature: string): boolean {
    if (!signature) {
      return false;
    }

    const expected = Buffer.from(this.sign(payload), "hex");
    const received = Buffer.from(signature, "hex");

    if (expected.length !== received.length) {
      return false;
    }

    return timingSafeEqual(expected, received);
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((result, [key, nested]) => {
        result[key] = sortValue(nested);
        return result;
      }, {});
  }

  return value;
}
