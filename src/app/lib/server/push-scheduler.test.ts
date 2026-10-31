import { describe, expect, test } from "bun:test";
import type { ForecastPoint } from "../grid";
import type { StoredSubscription } from "./push";
import { plan } from "./push-scheduler";
import type { Standing } from "./leaderboard";

// IST wall-clock time as a timestamp.
const ist = (local: string) => Date.parse(`${local}+05:30`);
const LB_ID = "00000000-0000-4000-8000-000000000001";

const sub = (extra: Partial<StoredSubscription> = {}): StoredSubscription => ({
  subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p", auth: "a" } },
  state: "maharashtra",
  name: "Pune",
  prefs: { bestTime: false, dailyDigest: false, streakReminders: false, leaderboard: true, progress: true },
  streak: 0,
  lastChargeDay: null,
  leaderboardId: "00000000-0000-4000-8000-000000000001",
  badge: null,
  week: null,
  sent: {},
  updatedAt: 0,
  ...extra,
});
const standing = (rank: number, extra: Partial<Standing> = {}): Standing => ({ rank, total: 5, points: 100, co2Kg: 12.5, above: rank > 1 ? "Meera" : null, aboveId: rank > 1 ? "id-meera" : null, ...extra });
const bodies = (result: ReturnType<typeof plan>) => result.planned.map((item) => item.payload.body);

describe("leaderboard: overtaken", () => {
  const now = ist("2026-10-14T15:00:00");

  test("a worse rank than last run this month says who passed you", () => {
    const result = plan(sub({ lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: LB_ID } }), undefined, now, { current: standing(3), lastMonth: null });
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].payload).toMatchObject({ body: "Meera passed you on the leaderboard. You're now #3 this month.", url: "/rewards/leaderboard" });
    expect(result.planned[0].marks).toEqual(["overtake"]);
    expect(result.lb).toEqual({ month: "2026-10", rank: 3, aboveId: "id-meera", leaderboardId: LB_ID });
  });

  test("at most once a day", () => {
    const result = plan(sub({ lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: LB_ID }, sent: { overtake: "2026-10-14" } }), undefined, now, { current: standing(3), lastMonth: null });
    expect(result.planned).toHaveLength(0);
    expect(result.lb).toEqual({ month: "2026-10", rank: 3, aboveId: "id-meera", leaderboardId: LB_ID });
  });

  test("not when the rank held or improved, or the last rank was from another month", () => {
    expect(bodies(plan(sub({ lb: { month: "2026-10", rank: 3, aboveId: null, leaderboardId: LB_ID } }), undefined, now, { current: standing(3), lastMonth: null }))).toEqual([]);
    expect(bodies(plan(sub({ lb: { month: "2026-10", rank: 4, aboveId: null, leaderboardId: LB_ID } }), undefined, now, { current: standing(3), lastMonth: null }))).toEqual([]);
    expect(bodies(plan(sub({ lb: { month: "2026-09", rank: 1, aboveId: null, leaderboardId: LB_ID } }), undefined, now, { current: standing(3), lastMonth: null }))).toEqual([]);
    expect(bodies(plan(sub(), undefined, now, { current: standing(3), lastMonth: null }))).toEqual([]);
  });

  test("not when the switch is off (no standing is loaded then)", () => {
    expect(plan(sub({ prefs: { ...sub().prefs, leaderboard: false }, lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: LB_ID } }), undefined, now).planned).toEqual([]);
  });
});

describe("leaderboard: reaching #1", () => {
  const now = ist("2026-10-14T15:00:00");

  test("once a month, and only with someone to beat", () => {
    const first = plan(sub({ lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: LB_ID } }), undefined, now, { current: standing(1), lastMonth: null });
    expect(bodies(first)).toEqual(["You're #1 on the leaderboard this month. Keep charging clean to stay there."]);
    expect(first.planned[0].marks).toEqual(["top"]);
    expect(bodies(plan(sub({ lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: LB_ID }, sent: { top: "2026-10" } }), undefined, now, { current: standing(1), lastMonth: null }))).toEqual([]);
    expect(bodies(plan(sub({ lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: LB_ID } }), undefined, now, { current: standing(1, { total: 1 }), lastMonth: null }))).toEqual([]);
  });
});

describe("leaderboard: month-end result", () => {
  test("on the 1st, 9 am to noon, once", () => {
    const now = ist("2026-11-01T09:30:00");
    const result = plan(sub(), undefined, now, { current: null, lastMonth: standing(2, { total: 14, co2Kg: 61 }) });
    expect(result.planned[0].payload).toMatchObject({ title: "October's leaderboard is final", body: "You finished #2 of 14, with 61.0 kg CO₂ avoided. Share your result.", url: "/profile?share=last-month" });
    expect(result.planned[0].marks).toEqual(["monthEnd"]);
    expect(bodies(plan(sub({ sent: { monthEnd: "2026-11" } }), undefined, now, { current: null, lastMonth: standing(2) }))).toEqual([]);
    expect(bodies(plan(sub(), undefined, ist("2026-11-01T12:00:00"), { current: null, lastMonth: standing(2) }))).toEqual([]);
    expect(bodies(plan(sub(), undefined, ist("2026-11-02T09:30:00"), { current: null, lastMonth: standing(2) }))).toEqual([]);
  });

  test("leaves out CO2 when it isn't known", () => {
    const result = plan(sub(), undefined, ist("2026-11-01T10:00:00"), { current: null, lastMonth: standing(1, { total: 3, co2Kg: null }) });
    expect(bodies(result)).toEqual(["You finished #1 of 3. Share your result."]);
  });
});

describe("badge nudge", () => {
  const badge = { key: "green-10", hint: "1 more green charge to unlock Green Regular." };

  test("6 pm hour, at most once every 3 days per badge", () => {
    const result = plan(sub({ badge }), undefined, ist("2026-10-14T18:30:00"));
    expect(result.planned[0].payload).toMatchObject({ title: "Almost there", body: badge.hint, url: "/rewards" });
    expect(result.planned[0].badge).toBe("green-10");
    expect(bodies(plan(sub({ badge, sent: { badges: { "green-10": "2026-10-12" } } }), undefined, ist("2026-10-14T18:30:00")))).toEqual([]);
    expect(bodies(plan(sub({ badge, sent: { badges: { "green-10": "2026-10-11" } } }), undefined, ist("2026-10-14T18:30:00")))).toEqual([badge.hint]);
    expect(bodies(plan(sub({ badge }), undefined, ist("2026-10-14T17:59:00")))).toEqual([]);
    expect(bodies(plan(sub({ badge, prefs: { ...sub().prefs, progress: false } }), undefined, ist("2026-10-14T18:30:00")))).toEqual([]);
  });
});

describe("weekly recap", () => {
  const sunday = ist("2026-10-18T18:30:00");

  test("Sunday 6-8 pm with at least one charge, instead of a badge nudge that evening", () => {
    const result = plan(sub({ week: { weekStart: "2026-10-12", charges: 4, co2Kg: 3.2, greenPercent: 75 }, badge: { key: "green-10", hint: "1 more green charge to unlock Green Regular." } }), undefined, sunday);
    expect(result.planned.map((item) => item.payload.title)).toEqual(["Your week in ZeroEmit"]);
    expect(result.planned[0].payload).toMatchObject({ body: "This week: 4 charges, 3.2 kg CO₂ avoided, 75% green.", url: "/profile" });
    expect(result.planned[0].marks).toEqual(["weekly"]);
  });

  test("singular, once, and skipped for an empty week or another day", () => {
    expect(bodies(plan(sub({ week: { weekStart: "2026-10-12", charges: 1, co2Kg: 0, greenPercent: 100 } }), undefined, sunday))).toEqual(["This week: 1 charge, 0.0 kg CO₂ avoided, 100% green."]);
    expect(bodies(plan(sub({ week: { weekStart: "2026-10-12", charges: 2, co2Kg: 1, greenPercent: 50 }, sent: { weekly: "2026-10-18" } }), undefined, sunday))).toEqual([]);
    expect(bodies(plan(sub({ week: { weekStart: "2026-10-12", charges: 0, co2Kg: 0, greenPercent: 0 } }), undefined, sunday))).toEqual([]);
    expect(bodies(plan(sub({ week: { weekStart: "2026-10-12", charges: 2, co2Kg: 1, greenPercent: 50 } }), undefined, ist("2026-10-17T18:30:00")))).toEqual([]);
  });
});

describe("best-time reminders", () => {
  test("carry a Log a charge action", () => {
    const now = ist("2026-10-14T21:10:00");
    const points: ForecastPoint[] = Array.from({ length: 30 }, (_, i) => ({ datetime: new Date(ist("2026-10-14T21:00:00") + i * 3_600_000).toISOString(), carbonIntensity: 500 }));
    const result = plan(sub({ prefs: { ...sub().prefs, bestTime: true } }), { points, dayFloor: 400, liveIsGreen: false }, now);
    const night = result.planned.find((item) => item.payload.tag === "zeroemit-night");
    expect(night?.payload.actions).toEqual([{ action: "log", title: "Log a charge" }]);
  });
});

describe("weekly recap freshness", () => {
  test("skipped when the device's totals are from an earlier week", () => {
    const stale = sub({ week: { weekStart: "2026-10-05", charges: 3, co2Kg: 2, greenPercent: 100 } });
    expect(plan(stale, undefined, Date.parse("2026-10-18T18:30:00+05:30")).planned).toEqual([]);
  });
});

describe("review fixes", () => {
  const now = ist("2026-10-14T15:00:00");
  const id = "00000000-0000-4000-8000-000000000001";

  test("a drop caused by someone else (same person still above) doesn't blame them", () => {
    const result = plan(sub({ lb: { month: "2026-10", rank: 3, aboveId: "id-meera", leaderboardId: id } }), undefined, now, { current: standing(4, { aboveId: "id-meera" }), lastMonth: null });
    expect(result.planned[0].payload).toMatchObject({ title: "Leaderboard update", body: "You dropped to #4 on the leaderboard this month." });
  });

  test("names the person only when they are new above you", () => {
    const result = plan(sub({ lb: { month: "2026-10", rank: 3, aboveId: "id-ravi", leaderboardId: id } }), undefined, now, { current: standing(4, { aboveId: "id-meera" }), lastMonth: null });
    expect(bodies(result)).toEqual(["Meera passed you on the leaderboard. You're now #4 this month."]);
    expect(result.lb).toEqual({ month: "2026-10", rank: 4, aboveId: "id-meera", leaderboardId: id });
  });

  test("a rank remembered for a different leaderboard entry is ignored", () => {
    const result = plan(sub({ lb: { month: "2026-10", rank: 1, aboveId: null, leaderboardId: "00000000-0000-4000-8000-000000000999" } }), undefined, now, { current: standing(4), lastMonth: null });
    expect(bodies(result)).toEqual([]);
  });

  test("a streak badge is only nudged while the streak is alive", () => {
    const badge = { key: "streak-7", hint: "1 more day in a row to unlock 7-Day Streak." };
    expect(bodies(plan(sub({ badge, lastChargeDay: "2026-10-13" }), undefined, ist("2026-10-14T18:30:00")))).toEqual([badge.hint]);
    expect(bodies(plan(sub({ badge, lastChargeDay: "2026-10-10" }), undefined, ist("2026-10-14T18:30:00")))).toEqual([]);
  });

  test("no badge nudge on a Sunday after the weekly recap already went out", () => {
    const badge = { key: "green-10", hint: "1 more green charge to unlock Green Regular." };
    const result = plan(sub({ badge, week: { weekStart: "2026-10-12", charges: 2, co2Kg: 1, greenPercent: 50 }, sent: { weekly: "2026-10-18" } }), undefined, ist("2026-10-18T18:15:00"));
    expect(result.planned).toEqual([]);
  });
});
