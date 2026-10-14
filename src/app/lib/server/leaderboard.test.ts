import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LeaderboardCharge } from "../leaderboard";

// In-memory stand-in for the Upstash REST client — only the commands the
// leaderboard uses, with Redis's ordering (score desc, then member desc).
const strings = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();
const zrevOrder = (key: string) => [...(zsets.get(key) ?? new Map<string, number>()).entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
  .map(([member]) => member);
async function fakeRedis(...command: (string | number)[]): Promise<unknown> {
  const [name, key, ...args] = command.map(String);
  switch (name) {
    case "GET": return strings.get(key) ?? null;
    case "SET": strings.set(key, args[0]); return "OK";
    case "DEL": return strings.delete(key) ? 1 : 0;
    case "MGET": return [key, ...args].map((k) => strings.get(k) ?? null);
    case "INCR": { const next = Number(strings.get(key) ?? 0) + 1; strings.set(key, String(next)); return next; }
    case "EXPIRE": return 1;
    case "ZADD": { const set = zsets.get(key) ?? new Map<string, number>(); set.set(args[1], Number(args[0])); zsets.set(key, set); return 1; }
    case "ZREM": return zsets.get(key)?.delete(args[0]) ? 1 : 0;
    case "ZCARD": return zsets.get(key)?.size ?? 0;
    case "ZREVRANGE": return zrevOrder(key).slice(Number(args[0]), Number(args[1]) + 1);
    case "ZREVRANK": { const index = zrevOrder(key).indexOf(args[0]); return index === -1 ? null : index; }
    default: throw new Error(`fake redis: unsupported ${name}`);
  }
}
mock.module("./redis", () => ({ redis: fakeRedis, redisConfigured: true }));
const { parseMemberBody, readLeaderboard, removeMember, submitMember } = await import("./leaderboard");

const NOW = Date.parse("2026-10-14T06:30:00.000Z"); // noon IST, 14 Oct
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// `count` one-a-day charges from 1 Oct: 10 points each, 15 when green.
const charges = (count: number, green = false): LeaderboardCharge[] =>
  Array.from({ length: count }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, kwh: 20, intensity: green ? 300 : 600, green }));
const member = (n: number, count: number, extra: Partial<{ name: string; zone: "western" | "southern"; key: string; green: boolean }> = {}) =>
  ({ id: uuid(n), key: extra.key ?? uuid(1000 + n), name: extra.name ?? `Player ${n}`, zone: extra.zone ?? "western", charges: charges(count, extra.green) });

beforeEach(() => { strings.clear(); zsets.clear(); });

describe("parseMemberBody", () => {
  const valid = { id: uuid(1), key: uuid(2), name: "Asha", zone: "western", charges: [{ date: "2026-10-01", kwh: 18, intensity: 420, green: true }] };

  test("accepts a valid body", () => {
    expect(parseMemberBody(valid)).toEqual(valid as never);
  });

  test("rejects bad ids, keys, names, zones, charges and oversized lists", () => {
    expect(parseMemberBody({ ...valid, id: "not-a-uuid" })).toBeNull();
    expect(parseMemberBody({ ...valid, key: 7 })).toBeNull();
    expect(parseMemberBody({ ...valid, name: "x" })).toBeNull();
    expect(parseMemberBody({ ...valid, zone: "central" })).toBeNull();
    expect(parseMemberBody({ ...valid, charges: [{ date: "2026-10-01", kwh: 18, green: true }] })).toBeNull(); // intensity missing
    expect(parseMemberBody({ ...valid, charges: [{ date: "1 Oct", kwh: 18, intensity: null, green: false }] })).toBeNull();
    expect(parseMemberBody({ ...valid, charges: [{ date: "2026-10-01", kwh: 0, intensity: null, green: false }] })).toBeNull();
    expect(parseMemberBody({ ...valid, charges: Array(101).fill(valid.charges[0]) })).toBeNull();
    expect(parseMemberBody(null)).toBeNull();
  });
});

describe("submitMember + readLeaderboard", () => {
  test("ranks members by recomputed monthly points", async () => {
    await submitMember(member(1, 3), NOW);              // 30
    await submitMember(member(2, 5), NOW);              // 50
    const third = await submitMember(member(3, 4, { green: true }), NOW); // 60
    expect(third).toEqual({ ok: true, rank: 1, points: 60, co2Kg: 28 }); // (650-300) x 20 x 4 = 28000 g

    const board = await readLeaderboard("all", uuid(1), NOW);
    expect(board.month).toBe("2026-10");
    expect(board.total).toBe(3);
    expect(board.rows.map((row) => [row.rank, row.name, row.points, row.isMe])).toEqual([[1, "Player 3", 60, false], [2, "Player 2", 50, false], [3, "Player 1", 30, true]]);
    expect(board.me?.rank).toBe(3);
  });

  test("a wrong key can't overwrite someone else's entry", async () => {
    await submitMember(member(1, 3), NOW);
    expect(await submitMember(member(1, 9, { key: uuid(999) }), NOW)).toEqual({ ok: false, status: 403 });
    expect((await readLeaderboard("all", null, NOW)).rows[0].points).toBe(30);
  });

  test("ties go to whoever reached the score first, and re-syncing doesn't lose that", async () => {
    await submitMember(member(1, 2), NOW);
    await submitMember(member(2, 2), NOW + 60_000);
    await submitMember(member(1, 2), NOW + 120_000); // same points again
    expect((await readLeaderboard("all", null, NOW + 120_000)).rows.map((row) => row.name)).toEqual(["Player 1", "Player 2"]);
  });

  test("region lists follow the member's zone, including a mid-month move", async () => {
    await submitMember(member(1, 3, { zone: "western" }), NOW);
    expect((await readLeaderboard("western", null, NOW)).rows).toHaveLength(1);
    expect((await readLeaderboard("southern", null, NOW)).rows).toHaveLength(0);

    await submitMember(member(1, 3, { zone: "southern" }), NOW + 1000);
    expect((await readLeaderboard("western", null, NOW)).rows).toHaveLength(0);
    expect((await readLeaderboard("southern", null, NOW)).rows[0].zone).toBe("southern");
    expect((await readLeaderboard("all", null, NOW)).rows).toHaveLength(1);
  });

  test("a member below the top 50 still gets their own row", async () => {
    for (let n = 1; n <= 51; n += 1) await submitMember(member(n, n % 14 + 1), NOW); // 10-140 points each
    await submitMember(member(99, 0), NOW); // 0 points: last of 52
    const board = await readLeaderboard("all", uuid(99), NOW);
    expect(board.total).toBe(52);
    expect(board.rows).toHaveLength(50);
    expect(board.rows.some((row) => row.isMe)).toBe(false);
    expect(board.me).toEqual({ rank: 52, name: "Player 99", zone: "western", points: 0, co2Kg: 0, isMe: true });
  });

  test("more than 30 updates an hour are refused", async () => {
    for (let i = 0; i < 30; i += 1) expect((await submitMember(member(1, 1), NOW)).ok).toBe(true);
    expect(await submitMember(member(1, 1), NOW)).toEqual({ ok: false, status: 429 });
    expect((await submitMember(member(1, 1), NOW + 3_600_000)).ok).toBe(true); // next hour
  });

  test("a new month starts a fresh board; last month's set keeps its entry", async () => {
    const september = Date.parse("2026-09-20T06:30:00.000Z");
    await submitMember({ ...member(1, 0), charges: [{ date: "2026-09-20", kwh: 20, intensity: 600, green: false }] }, september);
    expect((await readLeaderboard("all", null, september)).rows[0].points).toBe(10);
    expect((await readLeaderboard("all", null, NOW)).rows).toHaveLength(0);
    await submitMember(member(1, 2), NOW);
    expect((await readLeaderboard("all", null, NOW)).rows[0].points).toBe(20);
    // The member record holds only the latest month (only the current board
    // is ever shown), but September's set still lists them.
    expect(zsets.get("lb:2026-09:all")?.has(uuid(1))).toBe(true);
  });
});

describe("removeMember", () => {
  test("removes the entry from every list; the key is required", async () => {
    await submitMember(member(1, 3), NOW);
    expect(await removeMember(uuid(1), uuid(999))).toBe("forbidden");
    expect(await removeMember(uuid(1), uuid(1001))).toBe("ok");
    expect((await readLeaderboard("all", uuid(1), NOW))).toEqual({ month: "2026-10", total: 0, rows: [], me: null });
    expect((await readLeaderboard("western", null, NOW)).rows).toHaveLength(0);
  });

  test("removing someone who isn't there is fine", async () => {
    expect(await removeMember(uuid(5), uuid(6))).toBe("ok");
  });
});
