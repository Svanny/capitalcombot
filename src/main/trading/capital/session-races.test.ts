import { afterEach, describe, expect, it, vi } from "vitest";
import { CapitalClient } from "./client";

const credentials = { identifier: "account", password: "secret", apiKey: "key", environment: "demo" as const };
const session = () => new Response("{}", { headers: { CST: "cst", "X-SECURITY-TOKEN": "token" } });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { resolve, promise };
};
afterEach(() => vi.useRealTimers());

describe("session concurrency", () => {
  it("shares a saved-account login between maintenance and scheduled work", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>(() => pending.promise);
    const client = new CapitalClient(fetchMock);
    const checks = [client.ensureConnected(credentials), client.ensureConnected(credentials)];
    pending.resolve(session());
    await expect(Promise.all(checks)).resolves.toEqual([undefined, undefined]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("renews a rejected token on the next check without replaying the rejected request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(session())
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(session()).mockResolvedValueOnce(new Response('{"positions":[]}'));
    const client = new CapitalClient(fetchMock);
    await client.connect(credentials);
    await expect(client.listPositions()).rejects.toMatchObject({ code: "CAPITAL_401" });
    expect(client.isConnected()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(client.listPositions()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("does not reconnect when a login completes after disconnect", async () => {
    const pending = deferred<Response>();
    const client = new CapitalClient(vi.fn(() => pending.promise));
    const login = client.connect(credentials);
    const rejected = expect(login).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    await client.disconnect();
    pending.resolve(session());
    await rejected;
    expect(client.isConnected()).toBe(false);
  });

  it("does not erase a new connection when an old logout finishes", async () => {
    const logout = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(session())
      .mockReturnValueOnce(logout.promise).mockResolvedValueOnce(session());
    const client = new CapitalClient(fetchMock);
    await client.connect(credentials);
    const disconnect = client.disconnect();
    expect(client.isConnected()).toBe(false);
    await client.connect({ ...credentials, environment: "live" });
    logout.resolve(new Response("{}"));
    await disconnect;
    expect(client.isConnected()).toBe(true);
  });

  it("renews an expired session once for concurrent requests", async () => {
    vi.useFakeTimers();
    const renewal = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(session());
    const client = new CapitalClient(fetchMock);
    await client.connect(credentials);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
      ? renewal.promise : new Response('{"positions":[]}'));
    const requests = [client.listPositions(), client.listPositions(), client.listPositions()];
    renewal.resolve(session());
    await expect(Promise.all(requests)).resolves.toEqual([[], [], []]);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("connects a saved account when scheduled work starts before the app session", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(session());
    const client = new CapitalClient(fetchMock);

    await client.ensureConnected(credentials);

    expect(client.isConnected()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not silently reconnect after an explicit disconnect", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response("{}"))
      .mockResolvedValueOnce(session());
    const client = new CapitalClient(fetchMock);

    await client.connect(credentials);
    await client.disconnect();

    await expect(client.ensureConnected(credentials)).rejects.toMatchObject({ code: "NOT_CONNECTED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
