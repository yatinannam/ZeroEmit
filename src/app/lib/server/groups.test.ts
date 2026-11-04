import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LeaderboardCharge } from "../leaderboard";
import { isGroupCode, MAX_GROUP_MEMBERS, MAX_GROUPS_PER_MEMBER } from "../groups";
import { fakeRedis, fakeRedisModule, resetFakeRedis } from "./test-redis";

mock.module("./redis", () => fakeRedisModule);
const { removeMember, removeMembersByName, submitMember } = await import("./leaderboard");
const { createGroup, joinGroup, leaveGroup, listMemberGroups, readGroupBoard } = await import("./groups");

const NOW = Date.parse("2026-10-14T06:30:00.000Z"); // noon IST, 14 Oct
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (n: number) => uuid(1000 + n);
// `count` one-a-day charges from 1 Oct, 10 points each.
const charges = (count: number): LeaderboardCharge[] => Array.from({ length: count }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, kwh: 20, intensity: 600, green: false }));
const join = (n: number, count: number, at = NOW) => submitMember({ id: uuid(n), key: key(n), name: `Player ${n}`, zone: "western", charges: charges(count) }, at);

async function newGroup(n = 1, name = "Pune Office") {
  const result = await createGroup(uuid(n), key(n), name, NOW);
  if (!result.ok) throw new Error(result.error);
  return result.value.code;
}

beforeEach(() => { resetFakeRedis(); });
// The member's groups, as the list call returns them.
async function mine(n: number) {
  const result = await listMemberGroups(uuid(n), key(n), NOW);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("createGroup", () => {
  test("needs a leaderboard entry and its key", async () => {
    expect(await createGroup(uuid(1), key(1), "Pune Office", NOW)).toEqual({ ok: false, error: "not-member" });
    await join(1, 3);
    expect(await createGroup(uuid(1), key(2), "Pune Office", NOW)).toEqual({ ok: false, error: "forbidden" });
  });

  test("makes a code and puts the creator on its board with their score", async () => {
    await join(1, 3);
    const code = await newGroup();
    expect(isGroupCode(code)).toBe(true);
    const board = await readGroupBoard(code, uuid(1), NOW);
    expect(board?.group).toEqual({ code, name: "Pune Office", members: 1 });
    expect(board?.rows.map((row) => [row.name, row.points, row.isMe])).toEqual([["Player 1", 30, true]]);
  });

  test("a few an hour, and no more than the most groups allowed", async () => {
    await join(1, 1);
    for (let i = 0; i < 3; i += 1) await newGroup(1, `Group ${i}`);
    expect(await createGroup(uuid(1), key(1), "One more", NOW)).toEqual({ ok: false, error: "rate" });
    const later = NOW + 2 * 3_600_000;
    for (let i = 3; i < MAX_GROUPS_PER_MEMBER; i += 1) expect((await createGroup(uuid(1), key(1), `Group ${i}`, later)).ok).toBe(true);
    expect(await createGroup(uuid(1), key(1), "Too many", later + 3_600_000)).toEqual({ ok: false, error: "too-many" });
  });
});

describe("joinGroup", () => {
  test("joins by code; joining again changes nothing", async () => {
    await join(1, 3);
    await join(2, 5);
    const code = await newGroup();
    expect(await joinGroup(uuid(2), key(2), code, NOW)).toEqual({ ok: true, value: { code, name: "Pune Office", members: 2 } });
    expect(await joinGroup(uuid(2), key(2), code, NOW)).toEqual({ ok: true, value: { code, name: "Pune Office", members: 2 } });
    const board = await readGroupBoard(code, null, NOW);
    expect(board?.rows.map((row) => [row.rank, row.name])).toEqual([[1, "Player 2"], [2, "Player 1"]]);
    expect(board?.total).toBe(2);
  });

  test("refuses an unknown code, a full group, and members already in the most groups", async () => {
    await join(1, 1);
    expect(await joinGroup(uuid(1), key(1), "ABCDEF", NOW)).toEqual({ ok: false, error: "no-group" });
    const code = await newGroup();
    for (let n = 2; n <= MAX_GROUP_MEMBERS; n += 1) { await join(n, 1); expect((await joinGroup(uuid(n), key(n), code, NOW)).ok).toBe(true); }
    await join(99, 1);
    expect(await joinGroup(uuid(99), key(99), code, NOW)).toEqual({ ok: false, error: "full" });

    const others: string[] = [];
    for (let i = 0; i < MAX_GROUPS_PER_MEMBER; i += 1) others.push(await newGroup(10 + i, `Other ${i}`));
    for (const other of others) expect((await joinGroup(uuid(99), key(99), other, NOW)).ok).toBe(true);
    const sixth = await newGroup(20, "Sixth");
    expect(await joinGroup(uuid(99), key(99), sixth, NOW)).toEqual({ ok: false, error: "too-many" });
  });
});

describe("syncs and leaving", () => {
  test("a sync moves the member's score on every group board", async () => {
    await join(1, 3);
    await join(2, 5);
    const code = await newGroup();
    await joinGroup(uuid(2), key(2), code, NOW);
    await join(1, 9, NOW + 60_000);
    const board = await readGroupBoard(code, null, NOW + 60_000);
    expect(board?.rows.map((row) => [row.name, row.points])).toEqual([["Player 1", 90], ["Player 2", 50]]);
  });

  test("listMemberGroups gives each group's size and the member's rank", async () => {
    await join(1, 3);
    await join(2, 5);
    const code = await newGroup(1, "Zeta");
    const other = await newGroup(2, "Alpha");
    await joinGroup(uuid(2), key(2), code, NOW);
    expect((await mine(2))).toEqual([
      { code: other, name: "Alpha", members: 1, rank: 1, ranked: 1 },
      { code, name: "Zeta", members: 2, rank: 1, ranked: 2 },
    ]);
    expect(((await mine(1)))[0]).toMatchObject({ rank: 2, ranked: 2 });
  });

  test("no rank before a point this month, and expired groups drop off the list", async () => {
    await join(1, 0);
    const code = await newGroup();
    expect((await mine(1))).toEqual([{ code, name: "Pune Office", members: 1, rank: null, ranked: 0 }]);
    fakeRedis.strings.delete(`lb:group:${code}`);
    expect((await mine(1))).toEqual([]);
    expect(fakeRedis.hashes.get(`lb:mgroups:${uuid(1)}`)?.size ?? 0).toBe(0);
    expect(await readGroupBoard(code, null, NOW)).toBeNull();
  });

  test("leaving a group takes the member off its board and list", async () => {
    await join(1, 3);
    await join(2, 5);
    const code = await newGroup();
    await joinGroup(uuid(2), key(2), code, NOW);
    expect(await leaveGroup(uuid(2), key(2), code, NOW)).toEqual({ ok: true, value: null });
    const board = await readGroupBoard(code, null, NOW);
    expect(board?.group.members).toBe(1);
    expect(board?.rows.map((row) => row.name)).toEqual(["Player 1"]);
    expect((await mine(2))).toEqual([]);
    // A later sync doesn't put them back.
    await join(2, 6, NOW + 60_000);
    expect((await readGroupBoard(code, null, NOW + 60_000))?.rows.map((row) => row.name)).toEqual(["Player 1"]);
  });

  test("leaving the leaderboard leaves every group too", async () => {
    await join(1, 3);
    await join(2, 5);
    const code = await newGroup();
    await joinGroup(uuid(2), key(2), code, NOW);
    await removeMember(uuid(2), key(2));
    const board = await readGroupBoard(code, null, NOW);
    expect(board?.group.members).toBe(1);
    expect(board?.rows.map((row) => row.name)).toEqual(["Player 1"]);
    expect(fakeRedis.hashes.has(`lb:mgroups:${uuid(2)}`)).toBe(false);
  });

  test("an admin removal clears the entry from its groups", async () => {
    await join(1, 3);
    await join(2, 5);
    const code = await newGroup();
    await joinGroup(uuid(2), key(2), code, NOW);
    expect(await removeMembersByName("Player 2", "western", NOW)).toBe(1);
    expect((await readGroupBoard(code, null, NOW))?.group.members).toBe(1);
  });

  test("a member who left while their sync was in flight comes off the board again", async () => {
    await join(1, 3);
    await join(2, 5);
    const code = await newGroup();
    await joinGroup(uuid(2), key(2), code, NOW);
    // The leave reached the group's member list, but the sync had already read the member's own list.
    fakeRedis.hashes.get(`lb:group:${code}:members`)!.delete(uuid(2));
    await join(2, 6, NOW + 60_000);
    expect((await readGroupBoard(code, null, NOW + 60_000))?.rows.map((row) => row.name)).toEqual(["Player 1"]);
  });

  test("joins sent at once can't pass the limits", async () => {
    await join(1, 1);
    const codes: string[] = [];
    for (let i = 0; i < MAX_GROUPS_PER_MEMBER + 1; i += 1) { await join(10 + i, 1); codes.push(await newGroup(10 + i, `Group ${i}`)); }
    const results = await Promise.all(codes.map((code) => joinGroup(uuid(1), key(1), code, NOW)));
    expect(results.filter((result) => result.ok).length).toBeLessThanOrEqual(MAX_GROUPS_PER_MEMBER);
    expect((await mine(1)).length).toBeLessThanOrEqual(MAX_GROUPS_PER_MEMBER);
  });

  test("members whose entry has expired stop counting towards the group", async () => {
    await join(1, 3);
    await join(2, 5);
    const code = await newGroup();
    await joinGroup(uuid(2), key(2), code, NOW);
    fakeRedis.strings.delete(`lb:member:${uuid(2)}`);
    expect((await readGroupBoard(code, null, NOW))?.group.members).toBe(1);
    expect(fakeRedis.hashes.get(`lb:group:${code}:members`)?.has(uuid(2))).toBe(false);
  });

  test("listing a member's groups needs their key", async () => {
    await join(1, 3);
    expect(await listMemberGroups(uuid(1), key(2), NOW)).toEqual({ ok: false, error: "forbidden" });
    expect(await listMemberGroups(uuid(3), key(3), NOW)).toEqual({ ok: false, error: "not-member" });
  });
});
