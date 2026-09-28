import { createHash, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { STATES } from "../places";
import { redis, redisConfigured } from "./redis";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

export const pushConfigured = Boolean(publicKey && privateKey && subject && redisConfigured);
if (pushConfigured) webpush.setVapidDetails(subject!, publicKey!, privateKey!);

export type ServerPrefs = { bestTime: boolean; dailyDigest: boolean; streakReminders: boolean };
export type SentMarkers = Partial<Record<"day" | "night" | "digest" | "streak", string>>;
export type StoredSubscription = {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  state: string;
  name: string;
  prefs: ServerPrefs;
  streak: number;
  lastChargeDay: string | null;
  sent: SentMarkers;
  updatedAt: number;
};
export type PushPayload = { title: string; body: string; url: string; tag: string };

const SUBS_KEY = "push:subs";

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

export function parseSubscriptionBody(body: unknown): Omit<StoredSubscription, "sent" | "updatedAt"> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const sub = b.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const prefs = b.prefs as Record<string, unknown> | undefined;
  if (!sub || typeof sub.endpoint !== "string" || sub.endpoint.length > 1024 || !isPushServiceUrl(sub.endpoint)) return null;
  if (!isBase64Url(sub.keys?.p256dh, 200) || !isBase64Url(sub.keys?.auth, 64)) return null;
  if (typeof b.state !== "string" || !Object.hasOwn(STATES, b.state)) return null;
  if (typeof b.name !== "string" || b.name.length === 0 || b.name.length > 60) return null;
  if (!prefs || !isBool(prefs.bestTime) || !isBool(prefs.dailyDigest) || !isBool(prefs.streakReminders)) return null;
  if (!Number.isInteger(b.streak) || (b.streak as number) < 0 || (b.streak as number) > 10_000) return null;
  if (b.lastChargeDay !== null && !(typeof b.lastChargeDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.lastChargeDay))) return null;
  return {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys!.p256dh as string, auth: sub.keys!.auth as string } },
    state: b.state,
    name: b.name,
    prefs: { bestTime: prefs.bestTime, dailyDigest: prefs.dailyDigest, streakReminders: prefs.streakReminders },
    streak: b.streak as number,
    lastChargeDay: b.lastChargeDay as string | null,
  };
}

const idFor = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

// Keeps the "already sent today" markers across updates, so changing a
// setting mid-day doesn't re-send a reminder that already went out.
export async function saveSubscription(value: Omit<StoredSubscription, "sent" | "updatedAt">) {
  const id = idFor(value.subscription.endpoint);
  const existing = await redis<string | null>("HGET", SUBS_KEY, id);
  const sent = existing ? (JSON.parse(existing) as StoredSubscription).sent ?? {} : {};
  await redis("HSET", SUBS_KEY, id, JSON.stringify({ ...value, sent, updatedAt: Date.now() } satisfies StoredSubscription));
}

export async function removeSubscription(endpoint: string) {
  await redis("HDEL", SUBS_KEY, idFor(endpoint));
}

export async function getSubscription(endpoint: string): Promise<StoredSubscription | null> {
  const raw = await redis<string | null>("HGET", SUBS_KEY, idFor(endpoint));
  return raw ? JSON.parse(raw) as StoredSubscription : null;
}

// Allow one server test push per device per 30 seconds.
export async function claimTestSlot(endpoint: string) {
  return (await redis<string | null>("SET", `push:test:${idFor(endpoint)}`, "1", "NX", "EX", 30)) !== null;
}

export async function listSubscriptions(): Promise<StoredSubscription[]> {
  const flat = await redis<string[]>("HGETALL", SUBS_KEY) ?? [];
  const subs: StoredSubscription[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    try { subs.push(JSON.parse(flat[i]) as StoredSubscription); } catch { /* skip a corrupt entry */ }
  }
  return subs;
}

export async function updateSentMarkers(sub: StoredSubscription, sent: SentMarkers) {
  await redis("HSET", SUBS_KEY, idFor(sub.subscription.endpoint), JSON.stringify({ ...sub, sent }));
}

// Returns false (and forgets the subscription) when the push service says it
// no longer exists — the user uninstalled, cleared data, or revoked permission.
export async function sendPush(sub: StoredSubscription, payload: PushPayload): Promise<boolean> {
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 60 * 60, urgency: "normal" });
    return true;
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) await removeSubscription(sub.subscription.endpoint).catch(() => undefined);
    return false;
  }
}

export function isAuthorizedCron(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
