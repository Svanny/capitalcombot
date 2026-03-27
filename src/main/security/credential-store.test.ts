import { describe, expect, it, vi } from "vitest";
import type { CapitalCredentials } from "../../shared/types";
import {
  MemoryCredentialStore,
  createCredentialStore,
  type KeytarModuleLike,
} from "./credential-store";

const SAMPLE_CREDENTIALS: CapitalCredentials = {
  identifier: "name@example.com",
  password: "api-password",
  apiKey: "CAP-APIKEY-123",
  environment: "demo",
};

describe("createCredentialStore", () => {
  it("falls back to memory storage when keytar cannot load", async () => {
    const fallback = new MemoryCredentialStore();
    const result = await createCredentialStore({
      fallback,
      loadKeytar: vi.fn().mockRejectedValue(new Error("missing native module")),
    });

    expect(result.backend).toBe("memory");
    expect(result.store).toBe(fallback);
    expect(result.warning).toContain("macOS keychain is unavailable");
  });

  it("uses keytar when the native module is available", async () => {
    const keytar: KeytarModuleLike = {
      getPassword: vi.fn().mockResolvedValue(JSON.stringify(SAMPLE_CREDENTIALS)),
      setPassword: vi.fn().mockResolvedValue(undefined),
      deletePassword: vi.fn().mockResolvedValue(true),
    };
    const result = await createCredentialStore({
      loadKeytar: vi.fn().mockResolvedValue(keytar),
    });

    expect(result.backend).toBe("keytar");
    expect(result.warning).toBeUndefined();
    await expect(result.store.load()).resolves.toEqual(SAMPLE_CREDENTIALS);
  });
});
