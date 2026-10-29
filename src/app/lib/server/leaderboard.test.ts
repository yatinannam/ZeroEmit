import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LeaderboardCharge } from "../leaderboard";

import { fakeRedis, fakeRedisModule, resetFakeRedis } from "./test-redis";

mock.module("./redis", () => fakeRedisModule);
const { boardStandings, parseMemberBody, readLeaderboard, removeMember, removeMembersByName, submitMember } = await import("./leaderboard");

const NOW = Date.parse("2026-10-14T06:30:00.000Z"); // noon IST, 14 Oct
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// `count` one-a-day charges from 1 Oct: 10 points each, 15 when green.
const charges = (count: number, green = false): LeaderboardCharge[] =>
  Array.from({ length: count }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, kwh: 20, intensity: green ? 300 : 600, green }));
const member = (n: number, count: number, extra: Partial<{ name: string; zone: "western" | "southern"; key: string; green: boolean }> = {}) =>
  ({ id: uuid(n), key: extra.key ?? uuid(1000 + n), name: extra.name ?? `Player ${n}`, zone: extra.zone ?? "western", charges: charges(count, extra.green) });

beforeEach(() => { resetFakeRedis(); });

describe("parseMemberBody", () => {
  const valid = { id: uuid(1), key: uuid(2), name: "Asha", zone: "western", charges: [{ date: "2026-10-01", kwh: 18, intensity: 420, green: true }] };

  test("accepts a valid body", () => {
    expect(parseMemberBody(valid)).toEqual({ ...valid, charges: [{ ...valid.charges[0], hour: null, timing: null }] } as never); // missing hour and timing read as unknown
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

  test("accepts the charge hour and timing claim, and rejects bad ones", () => {
    const withTiming = (hour: unknown, timing: unknown) => parseMemberBody({ ...valid, charges: [{ date: "2026-10-01", kwh: 18, intensity: 420, green: true, hour, timing }] });
    expect(withTiming(12, "best")?.charges[0]).toMatchObject({ hour: 12, timing: "best" });
    expect(withTiming(null, null)?.charges[0]).toMatchObject({ hour: null, timing: null });
    expect(withTiming(24, "best")).toBeNull();
    expect(withTiming(1.5, "best")).toBeNull();
    expect(withTiming(12, "great")).toBeNull();
  });

  test("a tiny but positive charge is accepted, not a reason to reject the whole sync", () => {
    expect(parseMemberBody({ ...valid, charges: [{ date: "2026-10-01", kwh: 0.05, intensity: 420, green: true }] })).not.toBeNull();
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
    expect(board.total).toBe(51); // members with points; the 0-point requester still gets their row
    expect(board.rows).toHaveLength(50);
    expect(board.rows.some((row) => row.isMe)).toBe(false);
    expect(board.me).toEqual({ rank: 52, name: "Player 99", zone: "western", points: 0, co2Kg: 0, isMe: true });
  });

  test("more than 30 updates an hour are refused", async () => {
    for (let i = 0; i < 30; i += 1) expect((await submitMember(member(1, 1), NOW)).ok).toBe(true);
    expect(await submitMember(member(1, 1), NOW)).toEqual({ ok: false, status: 429 });
    expect((await submitMember(member(1, 1), NOW + 3_600_000)).ok).toBe(true); // next hour
  });

  test("one network address can create at most 20 new members an hour", async () => {
    for (let n = 1; n <= 20; n += 1) expect((await submitMember(member(n, 1), NOW, "203.0.113.7")).ok).toBe(true);
    expect(await submitMember(member(21, 1), NOW, "203.0.113.7")).toEqual({ ok: false, status: 429 });
    expect((await submitMember(member(1, 2), NOW, "203.0.113.7")).ok).toBe(true); // existing members still update
    expect((await submitMember(member(22, 1), NOW, "198.51.100.1")).ok).toBe(true); // other addresses unaffected
    expect((await submitMember(member(23, 1), NOW + 3_600_000, "203.0.113.7")).ok).toBe(true); // next hour
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
    expect(fakeRedis.zsets.get("lb:2026-09:all")?.has(uuid(1))).toBe(true);
  });
});

describe("round trips", () => {
  test("an update to an existing member takes at most 4 round trips", async () => {
    await submitMember(member(1, 3), NOW);
    fakeRedis.roundTrips = 0;
    await submitMember(member(1, 4), NOW + 1000);
    expect(fakeRedis.roundTrips).toBeLessThanOrEqual(4);
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

  test("a sync that arrives after leaving can't put the entry back", async () => {
    await submitMember(member(1, 3), NOW);
    await removeMember(uuid(1), uuid(1001));
    expect(await submitMember(member(1, 3), NOW + 1000)).toEqual({ ok: false, status: 410 });
    expect((await readLeaderboard("all", null, NOW)).rows).toHaveLength(0);
  });

  test("removing someone who isn't there is fine", async () => {
    expect(await removeMember(uuid(5), uuid(6))).toBe("ok");
  });
});

describe("boardStandings", () => {
  test("rank, total, points, CO2 and who is above, for many members from one read of the board", async () => {
    await submitMember(member(1, 5), NOW); // 50 points
    await submitMember(member(2, 3, { green: true }), NOW); // 45 points, (650-300) x 20 x 3 = 21 kg
    await submitMember(member(3, 2), NOW); // 20 points
    fakeRedis.roundTrips = 0;
    const standings = await boardStandings("2026-10", [uuid(2), uuid(1), uuid(9)]);
    expect(standings.get(uuid(2))).toEqual({ rank: 2, total: 3, points: 45, co2Kg: 21, above: "Player 1", aboveId: uuid(1) });
    expect(standings.get(uuid(1))).toMatchObject({ rank: 1, above: null, aboveId: null });
    expect(standings.has(uuid(9))).toBe(false);
    expect(fakeRedis.roundTrips).toBeLessThanOrEqual(2);
  });

  test("last month keeps rank and points, but not CO2 once the record moved on", async () => {
    const september = Date.parse("2026-09-20T06:30:00.000Z");
    await submitMember({ ...member(1, 0), charges: [{ date: "2026-09-20", kwh: 20, intensity: 600, green: false }] }, september);
    await submitMember(member(1, 2), NOW);
    expect((await boardStandings("2026-09", [uuid(1)])).get(uuid(1))).toEqual({ rank: 1, total: 1, points: 10, co2Kg: null, above: null, aboveId: null });
  });

  test("no members asked for, no reads", async () => {
    fakeRedis.roundTrips = 0;
    expect((await boardStandings("2026-10", [])).size).toBe(0);
    expect(fakeRedis.roundTrips).toBe(0);
  });
});

describe("removeMembersByName (admin)", () => {
  test("removes this month's entries with that name in that region, case-insensitively, and blocks a late sync", async () => {
    await submitMember(member(1, 2, { name: "Yatin Annam", zone: "southern" }), NOW);
    fakeRedis.hashes.clear(); // the second "Yatin Annam" predates unique names
    await submitMember(member(2, 3, { name: "Yatin Annam", zone: "western" }), NOW);
    await submitMember(member(3, 1, { name: "Hrishi", zone: "southern" }), NOW);
    expect(await removeMembersByName("yatin annam", "southern", NOW)).toBe(1);
    expect((await readLeaderboard("all", null, NOW)).rows.map((row) => `${row.name}/${row.zone}`)).toEqual(["Yatin Annam/western", "Hrishi/southern"]);
    expect((await readLeaderboard("southern", null, NOW)).rows.map((row) => row.name)).toEqual(["Hrishi"]);
    expect(await submitMember(member(1, 2, { name: "Yatin Annam", zone: "southern" }), NOW + 1000)).toEqual({ ok: false, status: 410 });
  });

  test("nothing to remove is fine", async () => {
    expect(await removeMembersByName("Nobody", "southern", NOW)).toBe(0);
  });
});

describe("unique names per month", () => {
  test("a new member can't take a name already on this month's board, ignoring case and spacing", async () => {
    expect((await submitMember(member(1, 3, { name: "Yatin Annam" }), NOW)).ok).toBe(true);
    expect(await submitMember(member(2, 1, { name: "yatin  annam" }), NOW)).toEqual({ ok: false, status: 409 });
    expect((await readLeaderboard("all", null, NOW)).rows.map((row) => row.name)).toEqual(["Yatin Annam"]);
  });

  test("a member keeps their own name on later syncs, and renaming frees the old one", async () => {
    await submitMember(member(1, 3, { name: "Yatin Annam" }), NOW);
    expect((await submitMember(member(1, 4, { name: "Yatin Annam" }), NOW + 1000)).ok).toBe(true);
    expect((await submitMember(member(1, 4, { name: "Yatin A" }), NOW + 2000)).ok).toBe(true);
    expect((await submitMember(member(2, 1, { name: "Yatin Annam" }), NOW + 3000)).ok).toBe(true);
    expect(await submitMember(member(3, 1, { name: "Yatin A" }), NOW + 4000)).toEqual({ ok: false, status: 409 });
  });

  test("leaving frees the name", async () => {
    await submitMember(member(1, 3, { name: "Asha" }), NOW);
    await removeMember(uuid(1), uuid(1001));
    expect((await submitMember(member(2, 1, { name: "Asha" }), NOW + 1000)).ok).toBe(true);
  });

  test("a member from before names were unique still syncs, and claims the name if it's free", async () => {
    await submitMember(member(1, 3, { name: "Asha" }), NOW);
    fakeRedis.hashes.clear(); // as if they joined before name claims existed
    expect((await submitMember(member(1, 4, { name: "Asha" }), NOW + 1000)).ok).toBe(true);
    expect(await submitMember(member(2, 1, { name: "Asha" }), NOW + 2000)).toEqual({ ok: false, status: 409 });
  });
});

describe("members with no points this month", () => {
  test("aren't listed, except to themselves, and don't count in the total", async () => {
    await submitMember(member(1, 2), NOW); // 20 points
    await submitMember(member(2, 0), NOW); // joined, no charges
    const others = await readLeaderboard("all", null, NOW);
    expect(others.rows.map((row) => row.name)).toEqual(["Player 1"]);
    expect(others.total).toBe(1);
    const mine = await readLeaderboard("all", uuid(2), NOW);
    expect(mine.rows.map((row) => row.name)).toEqual(["Player 1"]);
    expect(mine.me).toMatchObject({ name: "Player 2", points: 0, isMe: true });
  });
});

describe("removeMembersByName with a points limit (admin)", () => {
  test("removes only the matching entries at or under the limit", async () => {
    await submitMember(member(1, 6, { name: "Yatin Annam", zone: "southern" }), NOW);
    fakeRedis.hashes.clear(); // the duplicate below predates unique names
    await submitMember(member(2, 0, { name: "Yatin Annam", zone: "southern" }), NOW);
    expect(await removeMembersByName("Yatin Annam", "southern", NOW, 0)).toBe(1);
    expect((await readLeaderboard("all", null, NOW)).rows).toEqual([expect.objectContaining({ name: "Yatin Annam", points: 60 })]);
  });
});
