import { randomInt } from "node:crypto";
import { GROUP_CODE_ALPHABET, GROUP_CODE_LENGTH, MAX_GROUP_MEMBERS, MAX_GROUPS_PER_MEMBER, type GroupBoardResponse, type GroupInfo, type MyGroup } from "../groups";
import { istMonthKey } from "../leaderboard";
import { GROUP_RETENTION_S, groupBoardKey, groupKey, groupMembersKey, hashFields, memberGroups, memberGroupsKey, memberKey, readBoard, RETENTION_S, sortScore, verifiedMember, withinHourlyLimit, type MemberRecord } from "./leaderboard";
import { redis, redisTransaction } from "./redis";

// Group challenges: invite-only monthly boards joined with a code
// (lib/groups.ts). Only leaderboard members can be in one; their score
// reaches each of their group boards whenever they sync (submitMember).

type GroupRecord = { name: string; createdAt: number; createdBy: string };
// What went wrong, for the API to turn into a status and a `code` the app reads.
export type GroupError = "not-member" | "forbidden" | "no-group" | "too-many" | "full" | "rate";
export type GroupOutcome<T> = { ok: true; value: T } | { ok: false; error: GroupError };

// A member can make a few groups an hour, and try a few dozen codes: enough
// for a typo or two, far too few to guess someone else's code.
const CREATES_PER_HOUR = 3;
const JOINS_PER_HOUR = 20;

const fail = (error: GroupError): { ok: false; error: GroupError } => ({ ok: false, error });

async function member(id: string, key: string): Promise<MemberRecord | GroupError> {
  const record = await verifiedMember(id, key);
  return record === "missing" ? "not-member" : record === "forbidden" ? "forbidden" : record;
}

const newCode = () => Array.from({ length: GROUP_CODE_LENGTH }, () => GROUP_CODE_ALPHABET[randomInt(GROUP_CODE_ALPHABET.length)]).join("");

// The group's members whose leaderboard entry still exists. Entries expire
// after 70 days without a sync (someone who uninstalled, or cleared their
// data), so those are dropped from the group here rather than counting
// towards its size for ever.
async function liveMembers(code: string): Promise<string[]> {
  const ids = hashFields(await redis<string[]>("HGETALL", groupMembersKey(code)));
  if (!ids.length) return [];
  const records = await redis<(string | null)[]>("MGET", ...ids.map(memberKey));
  const gone = ids.filter((_, index) => records[index] === null);
  if (gone.length) await redis("HDEL", groupMembersKey(code), ...gone);
  return ids.filter((_, index) => records[index] !== null);
}

// Adds `id` to the group: its member list, the member's own list, and (with
// a score already this month) the group's board, all in one round trip.
// Resolves to the group's size and the member's group count afterwards, so
// a caller can back out of a join that two requests at once pushed past a
// limit (the checks before it can't see each other).
async function addToGroup(id: string, record: MemberRecord, code: string, now: number) {
  const month = istMonthKey(now);
  const results = await redisTransaction([
    ...(record.month === month ? [["ZADD", groupBoardKey(month, code), sortScore(record.points, record.scoredAt), id], ["EXPIRE", groupBoardKey(month, code), RETENTION_S]] : []),
    ["HSET", groupMembersKey(code), id, String(now)],
    ["EXPIRE", groupMembersKey(code), GROUP_RETENTION_S],
    ["EXPIRE", groupKey(code), GROUP_RETENTION_S],
    ["HSET", memberGroupsKey(id), code, String(now)],
    ["EXPIRE", memberGroupsKey(id), RETENTION_S],
    ["HLEN", groupMembersKey(code)],
    ["HLEN", memberGroupsKey(id)],
  ]);
  return { members: results.at(-2) as number, groups: results.at(-1) as number };
}

const removeFromGroup = (id: string, code: string, months: string[]) => redisTransaction([
  ["HDEL", groupMembersKey(code), id],
  ["HDEL", memberGroupsKey(id), code],
  ...[...new Set(months)].map((month) => ["ZREM", groupBoardKey(month, code), id]),
]);

// `name` must already be valid (validateGroupName). The creator joins it.
export async function createGroup(id: string, key: string, name: string, now = Date.now()): Promise<GroupOutcome<GroupInfo>> {
  const record = await member(id, key);
  if (typeof record === "string") return fail(record);
  if ((await memberGroups(id)).length >= MAX_GROUPS_PER_MEMBER) return fail("too-many");
  if (!(await withinHourlyLimit(`lb:gnew:${id}`, CREATES_PER_HOUR, now))) return fail("rate");
  const group: GroupRecord = { name, createdAt: now, createdBy: id };
  // A clash in a billion is rare, but a code must never land on someone else's group.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    if (await redis<string | null>("SET", groupKey(code), JSON.stringify(group), "NX", "EX", GROUP_RETENTION_S) === null) continue;
    const { groups } = await addToGroup(id, record, code, now);
    if (groups > MAX_GROUPS_PER_MEMBER) {
      await removeFromGroup(id, code, [istMonthKey(now)]);
      await redis("DEL", groupKey(code));
      return fail("too-many");
    }
    return { ok: true, value: { code, name, members: 1 } };
  }
  throw new Error("Couldn't find a free group code");
}

export async function joinGroup(id: string, key: string, code: string, now = Date.now()): Promise<GroupOutcome<GroupInfo>> {
  const record = await member(id, key);
  if (typeof record === "string") return fail(record);
  if (!(await withinHourlyLimit(`lb:gjoin:${id}`, JOINS_PER_HOUR, now))) return fail("rate");
  const raw = await redis<string | null>("GET", groupKey(code));
  if (!raw) return fail("no-group");
  const group = JSON.parse(raw) as GroupRecord;
  const [members, mine] = await Promise.all([liveMembers(code), memberGroups(id)]);
  const already = mine.includes(code);
  if (!already && mine.length >= MAX_GROUPS_PER_MEMBER) return fail("too-many");
  if (!already && members.length >= MAX_GROUP_MEMBERS) return fail("full");
  // Joining again is fine: it just refreshes the entry.
  const after = await addToGroup(id, record, code, now);
  if (!already && (after.groups > MAX_GROUPS_PER_MEMBER || after.members > MAX_GROUP_MEMBERS)) {
    await removeFromGroup(id, code, [istMonthKey(now)]);
    return fail(after.groups > MAX_GROUPS_PER_MEMBER ? "too-many" : "full");
  }
  return { ok: true, value: { code, name: group.name, members: after.members } };
}

// Leaving a group this member isn't in (or one that's gone) is already done.
export async function leaveGroup(id: string, key: string, code: string, now = Date.now()): Promise<GroupOutcome<null>> {
  const record = await member(id, key);
  if (typeof record === "string") return fail(record);
  await removeFromGroup(id, code, [record.month, istMonthKey(now)]);
  return { ok: true, value: null };
}

// This month's board for the group, or null when there's no such group.
export async function readGroupBoard(code: string, me: string | null, now = Date.now()): Promise<GroupBoardResponse | null> {
  const raw = await redis<string | null>("GET", groupKey(code));
  if (!raw) return null;
  const group = JSON.parse(raw) as GroupRecord;
  const month = istMonthKey(now);
  const [members, board] = await Promise.all([liveMembers(code), readBoard(groupBoardKey(month, code), month, me)]);
  return { ...board, group: { code, name: group.name, members: members.length } };
}

// The groups the member is in, each with its size and where they stand this
// month. Groups that have expired are dropped from the member's list.
export async function listMemberGroups(id: string, key: string, now = Date.now()): Promise<GroupOutcome<MyGroup[]>> {
  const record = await member(id, key);
  if (typeof record === "string") return fail(record);
  const codes = await memberGroups(id);
  if (!codes.length) return { ok: true, value: [] };
  const month = istMonthKey(now);
  const STEPS = 4;
  const results = await redisTransaction(codes.flatMap((code) => [
    ["GET", groupKey(code)],
    ["HLEN", groupMembersKey(code)],
    ["ZREVRANK", groupBoardKey(month, code), id],
    ["ZCOUNT", groupBoardKey(month, code), 1, "+inf"],
  ]));
  const groups: MyGroup[] = [];
  const gone: string[] = [];
  codes.forEach((code, index) => {
    const [raw, members, rank, ranked] = results.slice(index * STEPS, index * STEPS + STEPS) as [string | null, number, number | null, number];
    if (!raw) { gone.push(code); return; }
    // Members with a point sort above those without, so a rank inside the
    // first `ranked` means a point this month: only then is there a rank.
    groups.push({ code, name: (JSON.parse(raw) as GroupRecord).name, members, rank: rank !== null && rank < ranked ? rank + 1 : null, ranked });
  });
  if (gone.length) await redis("HDEL", memberGroupsKey(id), ...gone);
  return { ok: true, value: groups.sort((a, b) => a.name.localeCompare(b.name)) };
}
