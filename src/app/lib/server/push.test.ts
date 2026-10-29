import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeRedisModule, resetFakeRedis } from "./test-redis";

mock.module("./redis", () => fakeRedisModule);
const { listSubscriptions, parseSubscriptionBody, removeSubscription, saveSubscription, updateSubscriptionState } = await import("./push");
beforeEach(() => { resetFakeRedis(); });

const base = {
  subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } },
  state: "maharashtra",
  name: "Pune",
  prefs: { bestTime: true, dailyDigest: true, streakReminders: true, leaderboard: true, progress: false },
  streak: 3,
  lastChargeDay: "2026-10-13",
  leaderboardId: "00000000-0000-4000-8000-000000000001",
  badge: { key: "green-10", hint: "2 more green charges to unlock Green Regular." },
  week: { weekStart: "2026-10-12", charges: 4, co2Kg: 3.2, greenPercent: 75 },
};

describe("parseSubscriptionBody", () => {
  test("keeps the leaderboard id, closest badge, week and new switches", () => {
    const parsed = parseSubscriptionBody(base);
    expect(parsed?.leaderboardId).toBe(base.leaderboardId);
    expect(parsed?.badge).toEqual(base.badge);
    expect(parsed?.week).toEqual(base.week);
    expect(parsed?.prefs).toEqual(base.prefs);
  });

  test("an app from before these fields: no id, badge or week, and the new switches on", () => {
    const { leaderboardId, badge, week, ...old } = base;
    void leaderboardId; void badge; void week;
    const parsed = parseSubscriptionBody({ ...old, prefs: { bestTime: true, dailyDigest: false, streakReminders: true } });
    expect(parsed).toMatchObject({ leaderboardId: null, badge: null, week: null, prefs: { bestTime: true, dailyDigest: false, streakReminders: true, leaderboard: true, progress: true } });
  });

  test("nulls are accepted for not joined, no close badge and no week", () => {
    expect(parseSubscriptionBody({ ...base, leaderboardId: null, badge: null, week: null })).toMatchObject({ leaderboardId: null, badge: null, week: null });
  });

  test("rejects malformed new fields", () => {
    expect(parseSubscriptionBody({ ...base, leaderboardId: "abc" })).toBeNull();
    expect(parseSubscriptionBody({ ...base, badge: { key: "made-up", hint: "x" } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, badge: { key: "green-10", hint: "x".repeat(141) } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, badge: { key: "green-10", hint: "" } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, week: { weekStart: "2026-10-12", charges: 1.5, co2Kg: 1, greenPercent: 50 } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, week: { weekStart: "2026-10-12", charges: 2, co2Kg: -1, greenPercent: 50 } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, week: { weekStart: "2026-10-12", charges: 2, co2Kg: 1, greenPercent: 101 } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, prefs: { ...base.prefs, leaderboard: "yes" } })).toBeNull();
  });
});

describe("parseSubscriptionBody week start", () => {
  test("requires the week's Monday as a date", () => {
    expect(parseSubscriptionBody({ ...base, week: { ...base.week, weekStart: "last week" } })).toBeNull();
    const { weekStart, ...noStart } = base.week;
    void weekStart;
    expect(parseSubscriptionBody({ ...base, week: noStart })).toBeNull();
  });
});

describe("subscription storage", () => {
  const value = () => parseSubscriptionBody(base)!;

  test("a settings update from the device keeps what the scheduler recorded, and the reverse", async () => {
    await saveSubscription(value());
    const [stored] = await listSubscriptions();
    await updateSubscriptionState(stored, { sent: { day: "2026-10-14" }, lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: base.leaderboardId } });
    // The device turns a switch off while (or after) the scheduler ran.
    await saveSubscription({ ...value(), prefs: { ...value().prefs, leaderboard: false } });
    const [after] = await listSubscriptions();
    expect(after.prefs.leaderboard).toBe(false);
    expect(after.sent).toEqual({ day: "2026-10-14" });
    expect(after.lb?.rank).toBe(2);
    // And a scheduler write made with an older copy doesn't undo the switch.
    await updateSubscriptionState(stored, { sent: { day: "2026-10-14", digest: "2026-10-14" } });
    expect((await listSubscriptions())[0].prefs.leaderboard).toBe(false);
  });

  test("a scheduler write for a removed subscription doesn't bring it back", async () => {
    await saveSubscription(value());
    const [stored] = await listSubscriptions();
    await removeSubscription(base.subscription.endpoint);
    await updateSubscriptionState(stored, { sent: { day: "2026-10-14" } });
    expect(await listSubscriptions()).toEqual([]);
  });

  test("subscriptions stored before the split keep their sent markers", async () => {
    const legacy = { ...value(), sent: { digest: "2026-10-13" }, updatedAt: 1 };
    fakeRedisModule.redis("HSET", "push:subs", "legacy-id", JSON.stringify(legacy));
    expect((await listSubscriptions())[0].sent).toEqual({ digest: "2026-10-13" });
  });
});

describe("push keys", () => {
  test("must be a real P-256 public key (65 bytes, starting 0x04) and a 16-byte auth secret", () => {
    const keys = (p256dh: string, auth: string) => parseSubscriptionBody({ ...base, subscription: { ...base.subscription, keys: { p256dh, auth } } });
    expect(keys(base.subscription.keys.p256dh, base.subscription.keys.auth)).not.toBeNull();
    expect(keys("AAAA", base.subscription.keys.auth)).toBeNull(); // too short
    expect(keys("A" + base.subscription.keys.p256dh.slice(1), base.subscription.keys.auth)).toBeNull(); // not an uncompressed point
    expect(keys(base.subscription.keys.p256dh, "abcd")).toBeNull();
  });
});
