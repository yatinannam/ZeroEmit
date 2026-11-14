import { afterEach, describe, expect, test } from "bun:test";

// The real client, against a stubbed fetch. Other test files swap "./redis"
// for the in-memory fake for the whole run; the query string makes Bun load
// the real file anyway.
process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
// @ts-expect-error -- TypeScript can't resolve a specifier with a query string; the cast restores the types.
const { redis, redisTransaction, REDIS_TIMEOUT_MS } = (await import("./redis.ts?real")) as typeof import("./redis");
// Read once at import; don't leave them set for the test files after this one.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
let signals: (AbortSignal | null | undefined)[] = [];
// A request that hangs until its timeout fires, which here is at once.
const hang = () => {
  signals = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    signals.push(init?.signal);
    throw new DOMException("The operation timed out.", "TimeoutError");
  }) as typeof fetch;
};

describe("Redis REST calls", () => {
  test("carry a timeout, and a call that times out fails like any other Redis error", async () => {
    hang();
    expect(REDIS_TIMEOUT_MS).toBe(8000);
    await expect(redis("GET", "x")).rejects.toThrow("Redis request timed out after 8 s");
    await expect(redisTransaction([["GET", "x"]])).rejects.toThrow("Redis request timed out after 8 s");
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(await redis("GET", "x").catch(() => "handled")).toBe("handled");
  });

  test("an answer still comes back as before", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: "v" }), { status: 200 })) as unknown as typeof fetch;
    expect(await redis<string>("GET", "x")).toBe("v");
  });
});
