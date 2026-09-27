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
});
