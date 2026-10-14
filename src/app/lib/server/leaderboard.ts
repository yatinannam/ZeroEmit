import { createHash, timingSafeEqual } from "node:crypto";
import { istDayKey } from "../grid";
import { istMonthKey, LEADERBOARD_SIZE, MAX_SUBMITTED_CHARGES, scoreMonth, validateDisplayName, ZONES, type LeaderboardCharge, type LeaderboardResponse, type LeaderboardRow, type LeaderboardScope } from "../leaderboard";
import type { Zone } from "../places";
import { redis, redisConfigured } from "./redis";

export const leaderboardConfigured = redisConfigured;

const RETENTION_S = 70 * 24 * 60 * 60;
const UPDATES_PER_HOUR = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// `scoredAt` is when `points` last changed — it breaks ties, so it must not
// move when a re-sync leaves the score where it was.
type MemberRecord = { name: string; zone: Zone; keyHash: string; month: string; points: number; co2Kg: number; scoredAt: number; updatedAt: number };
export type MemberInput = { id: string; key: string; name: string; zone: Zone; charges: LeaderboardCharge[] };
export type SubmitResult = { ok: true; rank: number; points: number; co2Kg: number } | { ok: false; status: 403 | 429 };

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
  if (typeof charge.kwh !== "number" || !Number.isFinite(charge.kwh) || charge.kwh < 0.1) return null;
  if (charge.intensity !== null && (typeof charge.intensity !== "number" || !Number.isFinite(charge.intensity))) return null;
  if (typeof charge.green !== "boolean") return null;
  return { date: charge.date, kwh: charge.kwh, intensity: charge.intensity as number | null, green: charge.green };
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

export async function submitMember(input: MemberInput, now = Date.now()): Promise<SubmitResult> {
  const existing = await getMember(input.id);
  const keyHash = hashKey(input.key);
  if (existing && !sameHash(existing.keyHash, keyHash)) return { ok: false, status: 403 };

  const rateKey = `lb:rate:${input.id}:${Math.floor(now / 3_600_000)}`;
  const updates = await redis<number>("INCR", rateKey);
  if (updates === 1) await redis("EXPIRE", rateKey, 3600);
  if (updates > UPDATES_PER_HOUR) return { ok: false, status: 429 };

  const month = istMonthKey(now);
  const { points, co2Kg } = scoreMonth(input.charges, month, istDayKey(now));
  const sameMonth = existing !== null && existing.month === month;
  const scoredAt = sameMonth && existing.points === points ? existing.scoredAt : now;
  // Moved region this month: leave the old region's list (All India stays).
  if (sameMonth && existing.zone !== input.zone) await redis("ZREM", boardKey(month, existing.zone), input.id);

  const record: MemberRecord = { name: input.name, zone: input.zone, keyHash, month, points, co2Kg, scoredAt, updatedAt: now };
  const scopes: LeaderboardScope[] = ["all", input.zone];
  for (const scope of scopes) {
    await redis("ZADD", boardKey(month, scope), sortScore(points, scoredAt), input.id);
    await redis("EXPIRE", boardKey(month, scope), RETENTION_S);
  }
  await redis("SET", memberKey(input.id), JSON.stringify(record), "EX", RETENTION_S);
  const rank = await redis<number | null>("ZREVRANK", boardKey(month, "all"), input.id);
  return { ok: true, rank: (rank ?? 0) + 1, points, co2Kg };
}

export async function removeMember(id: string, key: string): Promise<"ok" | "forbidden"> {
  const existing = await getMember(id);
  if (!existing) return "ok";
  if (!sameHash(existing.keyHash, hashKey(key))) return "forbidden";
  await redis("ZREM", boardKey(existing.month, "all"), id);
  await redis("ZREM", boardKey(existing.month, existing.zone), id);
  await redis("DEL", memberKey(id));
  return "ok";
}

const toRow = (rank: number, record: MemberRecord, isMe: boolean): LeaderboardRow => ({ rank, name: record.name, zone: record.zone, points: record.points, co2Kg: record.co2Kg, isMe });

export async function readLeaderboard(scope: LeaderboardScope, me: string | null, now = Date.now()): Promise<LeaderboardResponse> {
  const month = istMonthKey(now);
  const key = boardKey(month, scope);
  const [ids, total] = await Promise.all([redis<string[]>("ZREVRANGE", key, 0, LEADERBOARD_SIZE - 1), redis<number>("ZCARD", key)]);
  const records = ids.length ? await redis<(string | null)[]>("MGET", ...ids.map(memberKey)) : [];
  const rows: LeaderboardRow[] = [];
  ids.forEach((id, index) => {
    const raw = records[index];
    if (raw) rows.push(toRow(index + 1, JSON.parse(raw) as MemberRecord, id === me));
  });
  let mine = rows.find((row) => row.isMe) ?? null;
  if (!mine && me) {
    const [rank, record] = await Promise.all([redis<number | null>("ZREVRANK", key, me), getMember(me)]);
    if (rank !== null && record) mine = toRow(rank + 1, record, true);
  }
  return { month, total, rows, me: mine };
}
