import { describe, expect, test } from "bun:test";
import { parseSubscriptionBody } from "./push";

const base = {
  subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } },
  state: "maharashtra",
  name: "Pune",
  prefs: { bestTime: true, dailyDigest: true, streakReminders: true, leaderboard: true, progress: false },
  streak: 3,
  lastChargeDay: "2026-10-13",
  leaderboardId: "00000000-0000-4000-8000-000000000001",
  badge: { key: "green-10", hint: "2 more green charges to unlock Green Regular." },
  week: { charges: 4, co2Kg: 3.2, greenPercent: 75 },
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
    expect(parseSubscriptionBody({ ...base, week: { charges: 1.5, co2Kg: 1, greenPercent: 50 } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, week: { charges: 2, co2Kg: -1, greenPercent: 50 } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, week: { charges: 2, co2Kg: 1, greenPercent: 101 } })).toBeNull();
    expect(parseSubscriptionBody({ ...base, prefs: { ...base.prefs, leaderboard: "yes" } })).toBeNull();
  });
});
