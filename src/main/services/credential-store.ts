import type { CapitalCredentials, SavedProfile } from "../../shared/types";

const SERVICE_NAME = "capitalcombot.capital";
const ACCOUNT_NAME = "primary";

export type CredentialBackend = "keytar" | "memory";

export interface CredentialStore {
  load(): Promise<CapitalCredentials | null>;
  save(credentials: CapitalCredentials): Promise<void>;
  clear(): Promise<void>;
  getSavedProfile(): Promise<SavedProfile | null>;
}

export interface KeytarModuleLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export interface CredentialStoreBootstrap {
  backend: CredentialBackend;
  store: CredentialStore;
  warning?: string;
}

export async function loadKeytarModule(): Promise<KeytarModuleLike> {
  const keytarModule = await import("keytar");

  return (keytarModule.default ?? keytarModule) as KeytarModuleLike;
}

export class KeytarCredentialStore implements CredentialStore {
  constructor(private readonly keytar: KeytarModuleLike) {}

  async load(): Promise<CapitalCredentials | null> {
    const payload = await this.keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);

    if (!payload) {
      return null;
    }

    return JSON.parse(payload) as CapitalCredentials;
  }

  async save(credentials: CapitalCredentials): Promise<void> {
    await this.keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(credentials));
  }

  async clear(): Promise<void> {
    await this.keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
  }

  async getSavedProfile(): Promise<SavedProfile | null> {
    const credentials = await this.load();

    if (!credentials) {
      return null;
    }

    return {
      identifier: credentials.identifier,
      environment: credentials.environment,
    };
  }
}

export async function createCredentialStore(options?: {
  fallback?: CredentialStore;
  loadKeytar?: () => Promise<KeytarModuleLike>;
}): Promise<CredentialStoreBootstrap> {
  const fallback = options?.fallback ?? new MemoryCredentialStore();
  const loadKeytar = options?.loadKeytar ?? loadKeytarModule;

  try {
    const keytar = await loadKeytar();

    return {
      backend: "keytar",
      store: new KeytarCredentialStore(keytar),
    };
  } catch {
    return {
      backend: "memory",
      store: fallback,
      warning:
        "macOS keychain is unavailable. Saved credentials will only be kept until the app closes.",
    };
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private credentials: CapitalCredentials | null = null;

  async load(): Promise<CapitalCredentials | null> {
    return this.credentials ? structuredClone(this.credentials) : null;
  }

  async save(credentials: CapitalCredentials): Promise<void> {
    this.credentials = structuredClone(credentials);
  }

  async clear(): Promise<void> {
    this.credentials = null;
  }

  async getSavedProfile(): Promise<SavedProfile | null> {
    if (!this.credentials) {
      return null;
    }

    return {
      identifier: this.credentials.identifier,
      environment: this.credentials.environment,
    };
  }
}
