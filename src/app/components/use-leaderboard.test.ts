import { beforeEach, describe, expect, test } from "bun:test";

// Minimal browser stand-ins: localStorage (read by the stores) and fetch
// (answering each request with the next queued status).
const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, String(value)); } },
    addEventListener() {},
    removeEventListener() {},
  },
});
// A queued answer: a status (body { rank: 1 }), "offline", or a status with its own body.
let statuses: (number | "offline" | { status: number; body: unknown })[] = [];
const requests: { method: string; body: string }[] = [];
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  requests.push({ method: init?.method ?? "GET", body: String(init?.body ?? "") });
  const status = statuses.shift() ?? 200;
  if (status === "offline") throw new TypeError("Failed to fetch");
  if (typeof status === "object") return new Response(JSON.stringify(status.body), { status: status.status });
  return new Response(JSON.stringify({ rank: 1 }), { status });
}) as typeof fetch;

const { getLeaderboardVersion, joinLeaderboard, leaveLeaderboard, retryPendingLeave, syncLeaderboard } = await import("./use-leaderboard");
const PENDING = "zeroemit-leaderboard-pending-leave";
const joined = () => JSON.parse(storage.get("zeroemit-leaderboard") ?? "null");

beforeEach(async () => {
  storage.clear();
  requests.length = 0;
  statuses = [200];
  await joinLeaderboard("Asha", "western", []);
  requests.length = 0;
});

describe("leaveLeaderboard", () => {
  test("a removal the server confirms leaves nothing pending", async () => {
    statuses = [200];
    expect(await leaveLeaderboard()).toBe(true);
    expect(joined()).toBeNull();
    expect(JSON.parse(storage.get(PENDING) ?? "[]")).toEqual([]);
  });

  test("a removal that fails is kept and retried until the server confirms it", async () => {
    const { id, key } = joined();
    statuses = [502];
    expect(await leaveLeaderboard()).toBe(false);
    expect(joined()).toBeNull();
    expect(JSON.parse(storage.get(PENDING) ?? "null")).toEqual([{ id, key }]);

    statuses = ["offline"];
    await retryPendingLeave();
    expect(JSON.parse(storage.get(PENDING) ?? "null")).toEqual([{ id, key }]);

    statuses = [200];
    await retryPendingLeave();
    expect(JSON.parse(storage.get(PENDING) ?? "[]")).toEqual([]);
    expect(requests.map((request) => [request.method, JSON.parse(request.body)])).toEqual([["DELETE", { id, key }], ["DELETE", { id, key }], ["DELETE", { id, key }]]);
  });

  test("a removal the server says isn't ours to make stops retrying", async () => {
    statuses = [403];
    await leaveLeaderboard();
    expect(JSON.parse(storage.get(PENDING) ?? "[]")).toEqual([]);
  });
});

describe("leaveLeaderboard, twice", () => {
  test("a second failed leave doesn't lose the first one's pending removal", async () => {
    const first = joined();
    statuses = [502];
    await leaveLeaderboard();
    statuses = [200];
    await joinLeaderboard("Asha", "western", []);
    const second = joined();
    statuses = [502];
    await leaveLeaderboard();
    requests.length = 0;
    statuses = [200, 200];
    await retryPendingLeave();
    expect(requests.map((request) => JSON.parse(request.body).id).sort()).toEqual([first.id, second.id].sort());
    expect(JSON.parse(storage.get(PENDING) ?? "null")).toEqual([]);
  });
});

describe("joinLeaderboard errors", () => {
  test("only a rejected name is blamed on the name", async () => {
    await leaveLeaderboard();
    statuses = [{ status: 400, body: { error: "Invalid name", code: "name" } }];
    expect(await joinLeaderboard("Asha", "western", [])).toEqual({ ok: false, error: "That name can't be used. Try another one." });
    statuses = [{ status: 400, body: { error: "Invalid request" } }];
    expect(await joinLeaderboard("Asha", "western", [])).toEqual({ ok: false, error: "Couldn't join the leaderboard. Try again." });
    statuses = [{ status: 409, body: { error: "Name taken", code: "name-taken" } }];
    expect(await joinLeaderboard("Asha", "western", [])).toEqual({ ok: false, error: "That name is already on this month's leaderboard. Try adding an initial, like \"Asha R\"." });
  });
});

describe("syncLeaderboard", () => {
  test("says whether the server accepted the update, so a failure can be retried", async () => {
    statuses = [502];
    expect(await syncLeaderboard("western", [])).toBe(false);
    statuses = ["offline"];
    expect(await syncLeaderboard("western", [])).toBe(false);
    statuses = [200];
    expect(await syncLeaderboard("western", [])).toBe(true);
  });

  test("a successful sync bumps the board version so open boards refetch; a failed one doesn't", async () => {
    const before = getLeaderboardVersion();
    statuses = [200];
    await syncLeaderboard("western", []);
    expect(getLeaderboardVersion()).toBe(before + 1);
    statuses = [502];
    await syncLeaderboard("western", []);
    statuses = ["offline"];
    await syncLeaderboard("western", []);
    expect(getLeaderboardVersion()).toBe(before + 1);
  });
});

describe("joining again after a lost response", () => {
  test("reuses the same id and key, so a join the server did save isn't duplicated", async () => {
    await leaveLeaderboard();
    requests.length = 0;
    statuses = ["offline"];
    await joinLeaderboard("Asha", "western", []);
    statuses = [200];
    await joinLeaderboard("Asha", "western", []);
    const [first, second] = requests.filter((request) => request.method === "POST").map((request) => JSON.parse(request.body));
    expect(second.id).toBe(first.id);
    expect(second.key).toBe(first.key);
    expect(joined().id).toBe(first.id);
  });
});
