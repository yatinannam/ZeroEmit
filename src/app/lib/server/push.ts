import { createHash, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { STATES } from "../places";
import { achievements } from "../rewards";
import { isUuid } from "./leaderboard";
import { redis, redisConfigured, redisTransaction } from "./redis";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

export const pushConfigured = Boolean(publicKey && privateKey && subject && redisConfigured);
if (pushConfigured) webpush.setVapidDetails(subject!, publicKey!, privateKey!);

export type ServerPrefs = { bestTime: boolean; dailyDigest: boolean; streakReminders: boolean; leaderboard: boolean; progress: boolean };
// Each marker holds the IST day (or month, for "top" and "monthEnd") it was
// last sent; `badges` holds that per badge key.
export type SentMarkers = Partial<Record<"day" | "night" | "digest" | "streak" | "overtake" | "top" | "monthEnd" | "weekly", string>> & { badges?: Record<string, string> };
export type BadgeHint = { key: string; hint: string };
// `weekStart` is the week's Monday (IST); an older week's totals are stale.
export type WeekSummary = { weekStart: string; charges: number; co2Kg: number; greenPercent: number };
export type StoredSubscription = {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  state: string;
  name: string;
  prefs: ServerPrefs;
  streak: number;
  lastChargeDay: string | null;
  // The device's public leaderboard id (never its key), its closest badge
  // when it's near, and this week's totals — for the engagement notifications.
  leaderboardId: string | null;
  badge: BadgeHint | null;
  week: WeekSummary | null;
  // The leaderboard rank seen on the last run, to notice being overtaken.
  // `aboveId` tells "someone passed you" apart from "a newcomer pushed you
  // down"; `leaderboardId` ties it to the entry it was seen for.
  lb?: { month: string; rank: number; aboveId: string | null; leaderboardId: string };
  sent: SentMarkers;
  updatedAt: number;
};
// `actions` become notification buttons where supported (not on iPhone);
// public/sw.js maps the "log" action to /log?quick=1.
export type PushPayload = { title: string; body: string; url: string; tag: string; actions?: { action: string; title: string }[] };

const SUBS_KEY = "push:subs";
// What the scheduler records (sent markers, last-seen rank) lives in its own
// hash, so the device saving its settings and the scheduler saving its state
// never overwrite each other's newer data.
const STATE_KEY = "push:state";
type SchedulerState = Pick<StoredSubscription, "sent" | "lb">;

// web-push POSTs to whatever endpoint a subscription names, so an unchecked
// endpoint would let anyone make this server send requests to arbitrary
// URLs. Only accept the browser vendors' push services.
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
function isPushServiceUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (PUSH_HOSTS.includes(url.hostname) || url.hostname.endsWith(".notify.windows.com") || url.hostname.endsWith(".push.apple.com"));
  } catch { return false; }
}

const isBase64Url = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+=*$/.test(value);
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
// A real subscription carries an uncompressed P-256 public key (65 bytes,
// first byte 0x04) and a 16-byte auth secret. Anything else makes web-push
// throw before sending, every run, so it's refused up front.
function validPushKeys(p256dh: string, auth: string) {
  const key = Buffer.from(p256dh, "base64url");
  return key.length === 65 && key[0] === 0x04 && Buffer.from(auth, "base64url").length === 16;
}
const BADGE_KEYS = new Set(achievements([], 0).map((badge) => badge.key));
const isBetween = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

// undefined (an app from before the field) and null both mean "none";
// false means malformed.
function parseBadge(raw: unknown): BadgeHint | null | false {
  if (raw === undefined || raw === null) return null;
  const badge = raw as Partial<BadgeHint>;
  if (typeof badge.key !== "string" || !BADGE_KEYS.has(badge.key) || typeof badge.hint !== "string" || badge.hint.length < 1 || badge.hint.length > 140) return false;
  return { key: badge.key, hint: badge.hint };
}

function parseWeek(raw: unknown): WeekSummary | null | false {
  if (raw === undefined || raw === null) return null;
  const week = raw as Partial<WeekSummary>;
  if (typeof week.weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(week.weekStart)) return false;
  if (!Number.isInteger(week.charges) || !isBetween(week.charges, 0, 1000) || !isBetween(week.co2Kg, 0, 100_000) || !Number.isInteger(week.greenPercent) || !isBetween(week.greenPercent, 0, 100)) return false;
  return { weekStart: week.weekStart, charges: week.charges, co2Kg: week.co2Kg, greenPercent: week.greenPercent };
}

// A switch an older app doesn't send yet defaults to on; null means malformed.
const optionalBool = (value: unknown): boolean | null => (value === undefined ? true : isBool(value) ? value : null);

export function parseSubscriptionBody(body: unknown): Omit<StoredSubscription, "sent" | "updatedAt" | "lb"> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sub = b.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const prefs = b.prefs as Record<string, unknown> | undefined;
  if (!sub || typeof sub.endpoint !== "string" || sub.endpoint.length > 1024 || !isPushServiceUrl(sub.endpoint)) return null;
  if (!isBase64Url(sub.keys?.p256dh, 200) || !isBase64Url(sub.keys?.auth, 64) || !validPushKeys(sub.keys.p256dh, sub.keys.auth)) return null;
  if (typeof b.state !== "string" || !Object.hasOwn(STATES, b.state)) return null;
  if (typeof b.name !== "string" || b.name.length === 0 || b.name.length > 60) return null;
  if (!prefs || !isBool(prefs.bestTime) || !isBool(prefs.dailyDigest) || !isBool(prefs.streakReminders)) return null;
  if (!Number.isInteger(b.streak) || (b.streak as number) < 0 || (b.streak as number) > 10_000) return null;
  if (b.lastChargeDay !== null && !(typeof b.lastChargeDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.lastChargeDay))) return null;
  const leaderboard = optionalBool(prefs.leaderboard);
  const progress = optionalBool(prefs.progress);
  if (leaderboard === null || progress === null) return null;
  const leaderboardId = b.leaderboardId ?? null;
  if (leaderboardId !== null && !isUuid(leaderboardId)) return null;
  const badge = parseBadge(b.badge);
  const week = parseWeek(b.week);
  if (badge === false || week === false) return null;
  return {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys!.p256dh as string, auth: sub.keys!.auth as string } },
    state: b.state,
    name: b.name,
    prefs: { bestTime: prefs.bestTime, dailyDigest: prefs.dailyDigest, streakReminders: prefs.streakReminders, leaderboard, progress },
    streak: b.streak as number,
    lastChargeDay: b.lastChargeDay as string | null,
    leaderboardId: leaderboardId as string | null,
    badge,
    week,
  };
}

const idFor = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

// Only the device's settings: the scheduler's state is kept separately, so
// the "already sent today" markers survive a mid-day settings change.
export async function saveSubscription(value: Omit<StoredSubscription, "sent" | "updatedAt" | "lb">) {
  await redis("HSET", SUBS_KEY, idFor(value.subscription.endpoint), JSON.stringify({ ...value, updatedAt: Date.now() }));
}

export async function removeSubscription(endpoint: string) {
  const id = idFor(endpoint);
  await redisTransaction([["HDEL", SUBS_KEY, id], ["HDEL", STATE_KEY, id]]);
}

export async function getSubscription(endpoint: string): Promise<StoredSubscription | null> {
  const raw = await redis<string | null>("HGET", SUBS_KEY, idFor(endpoint));
  return raw ? JSON.parse(raw) as StoredSubscription : null;
}

// Allow one server test push per device per 30 seconds.
export async function claimTestSlot(endpoint: string) {
  return (await redis<string | null>("SET", `push:test:${idFor(endpoint)}`, "1", "NX", "EX", 30)) !== null;
}

// Every subscription with its scheduler state. State left over for a
// subscription that's since been removed is ignored, so it can't revive it.
export async function listSubscriptions(): Promise<StoredSubscription[]> {
  const [subsFlat, statesFlat] = await redisTransaction([["HGETALL", SUBS_KEY], ["HGETALL", STATE_KEY]]) as [string[] | null, string[] | null];
  const states = new Map<string, SchedulerState>();
  for (let i = 1; i < (statesFlat ?? []).length; i += 2) {
    try { states.set(statesFlat![i - 1], JSON.parse(statesFlat![i]) as SchedulerState); } catch { /* skip a corrupt entry */ }
  }
  const subs: StoredSubscription[] = [];
  for (let i = 1; i < (subsFlat ?? []).length; i += 2) {
    try {
      const sub = JSON.parse(subsFlat![i]) as StoredSubscription;
      // Subscriptions saved before the split carried their state inline.
      const state = states.get(subsFlat![i - 1]) ?? { sent: sub.sent ?? {}, lb: sub.lb };
      subs.push({ ...sub, sent: state.sent ?? {}, lb: state.lb });
    } catch { /* skip a corrupt entry */ }
  }
  return subs;
}

export async function updateSubscriptionState(sub: StoredSubscription, state: SchedulerState) {
  await redis("HSET", STATE_KEY, idFor(sub.subscription.endpoint), JSON.stringify(state));
}

// "gone" (and the subscription is forgotten, state and all) when the push
// service says it no longer exists — the user uninstalled, cleared data, or
// revoked permission. "failed" is anything worth retrying later.
export async function sendPush(sub: StoredSubscription, payload: PushPayload): Promise<"sent" | "failed" | "gone"> {
  try {
    // A hung push service must not hold up everyone else's reminders.
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 60 * 60, urgency: "normal", timeout: 8000 });
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== 404 && status !== 410) return "failed";
    await removeSubscription(sub.subscription.endpoint).catch(() => undefined);
    return "gone";
  }
}

export function isAuthorizedCron(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
