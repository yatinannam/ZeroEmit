import { createHash, timingSafeEqual } from "node:crypto";
import { istDayKey } from "../grid";
import { istMonthKey, LEADERBOARD_SIZE, MAX_SUBMITTED_CHARGES, scoreMonth, validateDisplayName, ZONES, type LeaderboardCharge, type LeaderboardResponse, type LeaderboardRow, type LeaderboardScope } from "../leaderboard";
import type { Zone } from "../places";
import { CHARGE_TIMINGS, type ChargeTiming } from "../timing";
import { redis, redisConfigured, redisTransaction } from "./redis";

export const leaderboardConfigured = redisConfigured;

const RETENTION_S = 70 * 24 * 60 * 60;
const UPDATES_PER_HOUR = 30;
const NEW_MEMBERS_PER_ADDRESS_PER_HOUR = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// `scoredAt` is when `points` last changed — it breaks ties, so it must not
// move when a re-sync leaves the score where it was.
type MemberRecord = { name: string; zone: Zone; keyHash: string; month: string; points: number; co2Kg: number; scoredAt: number; updatedAt: number };
export type MemberInput = { id: string; key: string; name: string; zone: Zone; charges: LeaderboardCharge[] };
export type SubmitResult = { ok: true; rank: number; points: number; co2Kg: number } | { ok: false; status: 403 | 409 | 410 | 429 };

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
export const isZone = (value: unknown): value is Zone => typeof value === "string" && (ZONES as string[]).includes(value);

const memberKey = (id: string) => `lb:member:${id}`;
const boardKey = (month: string, scope: LeaderboardScope) => `lb:${month}:${scope}`;
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
function sameHash(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
// Sorted-set score: points, plus a fraction that is larger the earlier the
// score was reached (seconds keep it well inside double precision).
const sortScore = (points: number, scoredAt: number) => points + (2e10 - Math.floor(scoredAt / 1000)) / 1e11;

function parseCharge(raw: unknown): LeaderboardCharge | null {
  if (!raw || typeof raw !== "object") return null;
  const charge = raw as Record<string, unknown>;
  if (typeof charge.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(charge.date)) return null;
  // Any positive amount: scoring clamps it, and refusing one odd old charge
  // would reject every sync from that device.
  if (typeof charge.kwh !== "number" || !Number.isFinite(charge.kwh) || charge.kwh <= 0) return null;
  if (charge.intensity !== null && (typeof charge.intensity !== "number" || !Number.isFinite(charge.intensity))) return null;
  if (typeof charge.green !== "boolean") return null;
  // Optional (older apps don't send them); null means "not known".
  const hour = charge.hour ?? null;
  if (hour !== null && !(Number.isInteger(hour) && (hour as number) >= 0 && (hour as number) <= 23)) return null;
  const timing = charge.timing ?? null;
  if (timing !== null && !(CHARGE_TIMINGS as unknown[]).includes(timing)) return null;
  return { date: charge.date, kwh: charge.kwh, intensity: charge.intensity as number | null, green: charge.green, hour: hour as number | null, timing: timing as ChargeTiming | null };
}

export function parseMemberBody(body: unknown): MemberInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const name = validateDisplayName(value.name);
  if (!isUuid(value.id) || !isUuid(value.key) || !name || !isZone(value.zone)) return null;
  if (!Array.isArray(value.charges) || value.charges.length > MAX_SUBMITTED_CHARGES) return null;
  const charges = value.charges.map(parseCharge);
  if (charges.some((charge) => charge === null)) return null;
  return { id: value.id, key: value.key, name, zone: value.zone, charges: charges as LeaderboardCharge[] };
}

async function getMember(id: string): Promise<MemberRecord | null> {
  const raw = await redis<string | null>("GET", memberKey(id));
  return raw ? JSON.parse(raw) as MemberRecord : null;
}

// Set when a member leaves, so a sync that was already on its way can't
// recreate the entry under a key the device has forgotten.
const removedKey = (id: string) => `lb:removed:${id}`;
// One member per display name each month, so the board never shows two
// "Yatin Annam"s: field = the name ignoring case, spacing and joiners.
const namesKey = (month: string) => `lb:${month}:names`;
const nameClaim = (name: string) => name.replace(/[‌‍]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const REMOVED_MARKER_S = 24 * 60 * 60;

// Counts one more event in this hour's bucket; true while still within `limit`.
async function withinHourlyLimit(name: string, limit: number, now: number) {
  const key = `${name}:${Math.floor(now / 3_600_000)}`;
  const count = await redis<number>("INCR", key);
  if (count === 1) await redis("EXPIRE", key, 3600);
  return count <= limit;
}

// `ip` is the caller's address. New members are capped per address, so a
// script minting fresh ids can't flood the board or burn through the Redis
// quota that push reminders share. High enough for a class on one Wi-Fi.
// `pattern`: the region's typical day (by IST hour), to judge each charge's
// timing on the server; null when the server has no grid data for it.
export async function submitMember(input: MemberInput, now = Date.now(), ip: string | null = null, pattern: (number | null)[] | null = null): Promise<SubmitResult> {
  const [rawMember, removed] = await redis<(string | null)[]>("MGET", memberKey(input.id), removedKey(input.id));
  if (removed) return { ok: false, status: 410 };
  const existing = rawMember ? JSON.parse(rawMember) as MemberRecord : null;
  const keyHash = hashKey(input.key);
  if (existing && !sameHash(existing.keyHash, keyHash)) return { ok: false, status: 403 };
  if (!existing && ip && !(await withinHourlyLimit(`lb:new:${ip}`, NEW_MEMBERS_PER_ADDRESS_PER_HOUR, now))) return { ok: false, status: 429 };
  if (!(await withinHourlyLimit(`lb:rate:${input.id}`, UPDATES_PER_HOUR, now))) return { ok: false, status: 429 };

  const month = istMonthKey(now);
  const sameMonth = existing !== null && existing.month === month;
  const claim = nameClaim(input.name);
  const oldClaim = sameMonth ? nameClaim(existing.name) : null;
  // Joining, or renaming this month, needs a name nobody else holds. A member
  // carrying on into a new month keeps syncing either way.
  if (!existing || (sameMonth && oldClaim !== claim)) {
    const holder = await redis<string | null>("HGET", namesKey(month), claim);
    if (holder && holder !== input.id) return { ok: false, status: 409 };
  }
  const { points, co2Kg } = scoreMonth(input.charges, month, istDayKey(now), pattern);
  const scoredAt = sameMonth && existing.points === points ? existing.scoredAt : now;
  const record: MemberRecord = { name: input.name, zone: input.zone, keyHash, month, points, co2Kg, scoredAt, updatedAt: now };
  const score = sortScore(points, scoredAt);
  // One atomic round trip, so concurrent syncs can't leave the member in two
  // region lists. Moved region this month: leave the old region's list.
  const results = await redisTransaction([
    ...(sameMonth && existing.zone !== input.zone ? [["ZREM", boardKey(month, existing.zone), input.id]] : []),
    ["ZADD", boardKey(month, "all"), score, input.id],
    ["EXPIRE", boardKey(month, "all"), RETENTION_S],
    ["ZADD", boardKey(month, input.zone), score, input.id],
    ["EXPIRE", boardKey(month, input.zone), RETENTION_S],
    ["SET", memberKey(input.id), JSON.stringify(record), "EX", RETENTION_S],
    // Claim the name (no-op if already ours); a rename frees the old one.
    ...(oldClaim !== null && oldClaim !== claim ? [["HDEL", namesKey(month), oldClaim]] : []),
    ["HSETNX", namesKey(month), claim, input.id],
    ["EXPIRE", namesKey(month), RETENTION_S],
    ["ZREVRANK", boardKey(month, "all"), input.id],
  ]);
  const rank = results.at(-1) as number | null;
  return { ok: true, rank: (rank ?? 0) + 1, points, co2Kg };
}

export async function removeMember(id: string, key: string): Promise<"ok" | "forbidden"> {
  const existing = await getMember(id);
  if (!existing) return "ok";
  if (!sameHash(existing.keyHash, hashKey(key))) return "forbidden";
  const holder = await redis<string | null>("HGET", namesKey(existing.month), nameClaim(existing.name));
  await redisTransaction([
    ["ZREM", boardKey(existing.month, "all"), id],
    ["ZREM", boardKey(existing.month, existing.zone), id],
    ["DEL", memberKey(id)],
    ["SET", removedKey(id), "1", "EX", REMOVED_MARKER_S],
    // Leaving frees the name for someone else.
    ...(holder === id ? [["HDEL", namesKey(existing.month), nameClaim(existing.name)]] : []),
  ]);
  return "ok";
}

// Admin removal for an entry whose device can no longer leave (lost data,
// another browser) or an offensive name: every member of this month's board
// with that display name (case-insensitive) in that region. Each gets the
// same "removed" marker as a normal leave, so a late sync can't restore it.
// `maxPoints` narrows it to entries at or under that score, e.g. 0 to remove
// a duplicate that never logged a charge without touching the real one.
export async function removeMembersByName(name: string, zone: Zone, now = Date.now(), maxPoints: number | null = null): Promise<number> {
  const month = istMonthKey(now);
  const ids = await redis<string[]>("ZREVRANGE", boardKey(month, "all"), 0, -1);
  if (!ids.length) return 0;
  const raws = await redis<(string | null)[]>("MGET", ...ids.map(memberKey));
  const target = nameClaim(name);
  const matches = ids.filter((_, index) => {
    const record = raws[index] ? JSON.parse(raws[index]!) as MemberRecord : null;
    return record !== null && record.zone === zone && nameClaim(record.name) === target && (maxPoints === null || record.points <= maxPoints);
  });
  if (!matches.length) return 0;
  const holder = await redis<string | null>("HGET", namesKey(month), target);
  await redisTransaction([
    ...matches.flatMap((id) => [
      ["ZREM", boardKey(month, "all"), id],
      ["ZREM", boardKey(month, zone), id],
      ["DEL", memberKey(id)],
      ["SET", removedKey(id), "1", "EX", REMOVED_MARKER_S],
    ]),
    ...(holder && matches.includes(holder) ? [["HDEL", namesKey(month), target]] : []),
  ]);
  return matches.length;
}

export type Standing = { rank: number; total: number; points: number; co2Kg: number | null; above: string | null; aboveId: string | null };

// Where each of `ids` stands on `month`'s All India board, for the push
// scheduler: one read of the whole board plus one MGET for the records it
// needs, however many subscribers there are (the free Redis tier is billed
// per command). Points come from the board itself — the member record only
// holds the latest month — so CO₂ is known only while the record is that
// month's. Members not on the board are left out.
export async function boardStandings(month: string, ids: string[]): Promise<Map<string, Standing>> {
  const standings = new Map<string, Standing>();
  if (!ids.length) return standings;
  const flat = await redis<string[]>("ZREVRANGE", boardKey(month, "all"), 0, -1, "WITHSCORES");
  const order: string[] = [];
  const scores = new Map<string, number>();
  for (let i = 0; i < flat.length; i += 2) { order.push(flat[i]); scores.set(flat[i], Number(flat[i + 1])); }
  const indexOf = new Map(order.map((id, index) => [id, index]));
  const onBoard = ids.filter((id) => indexOf.has(id));
  if (!onBoard.length) return standings;
  const aboveOf = (id: string) => { const index = indexOf.get(id)!; return index > 0 ? order[index - 1] : null; };
  const needed = [...new Set(onBoard.flatMap((id) => [id, aboveOf(id)].filter((value): value is string => value !== null)))];
  const raws = await redis<(string | null)[]>("MGET", ...needed.map(memberKey));
  const records = new Map(needed.map((id, index) => [id, raws[index] ? JSON.parse(raws[index]!) as MemberRecord : null]));
  for (const id of onBoard) {
    const own = records.get(id);
    const aboveId = aboveOf(id);
    standings.set(id, { rank: indexOf.get(id)! + 1, total: order.length, points: Math.floor(scores.get(id)!), co2Kg: own && own.month === month ? own.co2Kg : null, above: aboveId ? records.get(aboveId)?.name ?? null : null, aboveId });
  }
  return standings;
}

const toRow = (rank: number, record: MemberRecord, isMe: boolean): LeaderboardRow => ({ rank, name: record.name, zone: record.zone, points: record.points, co2Kg: record.co2Kg, isMe });

export async function readLeaderboard(scope: LeaderboardScope, me: string | null, now = Date.now()): Promise<LeaderboardResponse> {
  const month = istMonthKey(now);
  const key = boardKey(month, scope);
  // Only members with points this month are listed and counted (scores are
  // points plus a fraction under 1, so ">= 1" means at least one charge);
  // someone who joined but hasn't charged sees their own status only.
  const [ids, total] = await Promise.all([redis<string[]>("ZREVRANGE", key, 0, LEADERBOARD_SIZE - 1), redis<number>("ZCOUNT", key, 1, "+inf")]);
  const records = ids.length ? await redis<(string | null)[]>("MGET", ...ids.map(memberKey)) : [];
  const rows: LeaderboardRow[] = [];
  ids.forEach((id, index) => {
    const raw = records[index];
    const record = raw ? JSON.parse(raw) as MemberRecord : null;
    if (record && record.points > 0) rows.push(toRow(index + 1, record, id === me));
  });
  let mine = rows.find((row) => row.isMe) ?? null;
  if (!mine && me) {
    const [rank, record] = await Promise.all([redis<number | null>("ZREVRANK", key, me), getMember(me)]);
    if (rank !== null && record) mine = toRow(rank + 1, record, true);
  }
  return { month, total, rows, me: mine };
}
