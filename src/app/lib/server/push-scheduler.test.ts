import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mergeLiveReading, type ForecastPoint } from "../grid";
import type { StoredSubscription } from "./push";
import type { Standing } from "./leaderboard";
import { fakeRedis, fakeRedisModule, resetFakeRedis } from "./test-redis";

// Every push handed to the push service, and how it answers (throw to fail).
const pushes: { endpoint: string; payload: { title: string; tag: string }; options: { TTL: number } }[] = [];
let pushAnswer: () => void = () => undefined;
mock.module("./redis", () => fakeRedisModule);
mock.module("web-push", () => ({ default: {
  setVapidDetails: () => undefined,
  sendNotification: async (subscription: { endpoint: string }, payload: string, options: { TTL: number }) => { pushAnswer(); pushes.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options }); return {}; },
} }));
const { plan, runPushSchedule } = await import("./push-scheduler");
const { listSubscriptions, saveSubscription } = await import("./push");

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
  test("on the 1st from 7 am, once", () => {
    const now = ist("2026-11-01T09:30:00");
    const result = plan(sub(), undefined, now, { current: null, lastMonth: standing(2, { total: 14, co2Kg: 61 }) });
    expect(result.planned[0].payload).toMatchObject({ title: "October's leaderboard is final", body: "You finished #2 of 14, with 61.0 kg CO₂ avoided. See your October recap.", url: "/recap?period=2026-10" });
    expect(result.planned[0].marks).toEqual(["monthEnd"]);
    expect(bodies(plan(sub({ sent: { monthEnd: "2026-11" } }), undefined, now, { current: null, lastMonth: standing(2) }))).toEqual([]);
    expect(bodies(plan(sub(), undefined, ist("2026-11-01T07:00:00"), { current: null, lastMonth: standing(2) }))).toHaveLength(1);
    expect(bodies(plan(sub(), undefined, ist("2026-11-01T21:59:00"), { current: null, lastMonth: standing(2) }))).toHaveLength(1);
    expect(bodies(plan(sub(), undefined, ist("2026-11-01T06:59:00"), { current: null, lastMonth: standing(2) }))).toEqual([]);
    expect(bodies(plan(sub(), undefined, ist("2026-11-01T22:00:00"), { current: null, lastMonth: standing(2) }))).toEqual([]);
  });

  test("still on the 2nd if no run got through on the 1st, but not later", () => {
    const result = plan(sub(), undefined, ist("2026-11-02T15:00:00"), { current: null, lastMonth: standing(2, { total: 14, co2Kg: 61 }) });
    expect(result.planned[0].payload).toMatchObject({ title: "October's leaderboard is final", url: "/recap?period=2026-10" });
    expect(bodies(plan(sub({ sent: { monthEnd: "2026-11" } }), undefined, ist("2026-11-02T15:00:00"), { current: null, lastMonth: standing(2) }))).toEqual([]);
    expect(bodies(plan(sub(), undefined, ist("2026-11-03T09:30:00"), { current: null, lastMonth: standing(2) }))).toEqual([]);
    // Last month is the one before, whatever its length.
    expect(plan(sub(), undefined, ist("2026-03-02T08:00:00"), { current: null, lastMonth: standing(2) }).planned[0].payload).toMatchObject({ title: "February's leaderboard is final", url: "/recap?period=2026-02" });
  });

  test("leaves out CO2 when it isn't known", () => {
    const result = plan(sub(), undefined, ist("2026-11-01T10:00:00"), { current: null, lastMonth: standing(1, { total: 3, co2Kg: null }) });
    expect(bodies(result)).toEqual(["You finished #1 of 3. See your October recap."]);
  });
});

describe("badge nudge", () => {
  const badge = { key: "green-10", hint: "1 more green charge to unlock Green Regular." };

  test("6 to 9 pm, so a late run still sends it, but once an evening", () => {
    expect(bodies(plan(sub({ badge }), undefined, ist("2026-10-14T20:50:00")))).toEqual([badge.hint]);
    expect(bodies(plan(sub({ badge }), undefined, ist("2026-10-14T21:00:00")))).toEqual([]);
    expect(bodies(plan(sub({ badge }), undefined, ist("2026-10-14T22:30:00")))).toEqual([]);
    // A second run after it went out, even for a badge that's now closer.
    expect(bodies(plan(sub({ badge, sent: { badges: { "green-10": "2026-10-14" } } }), undefined, ist("2026-10-14T19:40:00")))).toEqual([]);
    expect(bodies(plan(sub({ badge: { key: "streak-7", hint: "1 more day" }, lastChargeDay: "2026-10-14", sent: { badges: { "green-10": "2026-10-14" } } }), undefined, ist("2026-10-14T19:40:00")))).toEqual([]);
  });

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

  test("until 10 pm, so a late run still sends it, then never in quiet hours", () => {
    const week = { weekStart: "2026-10-12", charges: 2, co2Kg: 1, greenPercent: 50 };
    expect(bodies(plan(sub({ week }), undefined, ist("2026-10-18T21:50:00")))).toEqual(["This week: 2 charges, 1.0 kg CO₂ avoided, 50% green."]);
    expect(bodies(plan(sub({ week, sent: { weekly: "2026-10-18" } }), undefined, ist("2026-10-18T21:50:00")))).toEqual([]);
    expect(bodies(plan(sub({ week }), undefined, ist("2026-10-18T22:00:00")))).toEqual([]);
    expect(bodies(plan(sub({ week }), undefined, ist("2026-10-18T17:59:00")))).toEqual([]);
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

  // A day where only 1–3 pm is clean, planned the way a run does: hours
  // already over are dropped.
  const day: ForecastPoint[] = Array.from({ length: 24 }, (_, i) => ({ datetime: new Date(ist("2026-10-14T07:00:00") + i * 3_600_000).toISOString(), carbonIntensity: i === 6 || i === 7 ? 200 : 600 }));
  const bestTime = sub({ prefs: { ...sub().prefs, bestTime: true } });
  const titlesAt = (local: string, extra: Partial<StoredSubscription> = {}) => {
    const now = ist(local);
    return plan({ ...bestTime, ...extra }, { points: mergeLiveReading({ forecast: day }, now), dayFloor: 200, liveIsGreen: false }, now).planned.map((item) => item.payload.title);
  };

  test("a run that comes late, still before the window starts, sends it; one after the window has ended doesn't", () => {
    expect(titlesAt("2026-10-14T12:00:00")).toEqual([]); // an hour ahead: a later run will send it
    expect(titlesAt("2026-10-14T12:50:00")).toEqual(["Clean charging window at 1:00 pm"]);
    expect(titlesAt("2026-10-14T13:20:00")).toEqual(["Good time to charge now"]);
    expect(titlesAt("2026-10-14T15:10:00")).toEqual([]);
    expect(titlesAt("2026-10-14T13:20:00", { sent: { day: "2026-10-14" } })).toEqual([]);
  });

  test("tonight's best time from 8 pm, so a late run still sends it, once, and never in quiet hours", () => {
    const night = (local: string, extra: Partial<StoredSubscription> = {}) => {
      const now = ist(local);
      const points: ForecastPoint[] = Array.from({ length: 30 }, (_, i) => ({ datetime: new Date(ist("2026-10-14T19:00:00") + i * 3_600_000).toISOString(), carbonIntensity: 500 }));
      return plan({ ...bestTime, ...extra }, { points: mergeLiveReading({ forecast: points }, now), dayFloor: 400, liveIsGreen: false }, now).planned.filter((item) => item.payload.tag === "zeroemit-night").length;
    };
    expect(night("2026-10-14T19:59:00")).toBe(0);
    expect(night("2026-10-14T20:05:00")).toBe(1);
    expect(night("2026-10-14T21:55:00")).toBe(1);
    expect(night("2026-10-14T21:55:00", { sent: { night: "2026-10-14" } })).toBe(0);
    expect(night("2026-10-14T22:05:00")).toBe(0);
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

describe("leaderboard: no points, no news", () => {
  test("no #1, overtake or month-end push for a member without points", () => {
    const now = ist("2026-10-14T15:00:00");
    expect(bodies(plan(sub({ lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: LB_ID } }), undefined, now, { current: standing(1, { points: 0 }), lastMonth: null }))).toEqual([]);
    expect(bodies(plan(sub({ lb: { month: "2026-10", rank: 2, aboveId: null, leaderboardId: LB_ID } }), undefined, now, { current: standing(5, { points: 0 }), lastMonth: null }))).toEqual([]);
    expect(bodies(plan(sub(), undefined, ist("2026-11-01T09:30:00"), { current: null, lastMonth: standing(12, { total: 12, points: 0 }) }))).toEqual([]);
  });
});

describe("streak reminder", () => {
  test("opens the quick-log form and carries a Log a charge action", () => {
    const result = plan(sub({ prefs: { ...sub().prefs, streakReminders: true }, streak: 4, lastChargeDay: "2026-10-13" }), undefined, ist("2026-10-14T20:15:00"));
    const streak = result.planned.find((item) => item.payload.tag === "zeroemit-streak");
    expect(streak?.payload).toMatchObject({ title: "Keep your 4-day streak", url: "/log?quick=1", actions: [{ action: "log", title: "Log a charge" }] });
  });

  test("8 to 10 pm, once, and never in quiet hours", () => {
    const streak = (local: string, extra: Partial<StoredSubscription> = {}) => bodies(plan(sub({ prefs: { ...sub().prefs, streakReminders: true }, streak: 4, lastChargeDay: "2026-10-13", ...extra }), undefined, ist(local)));
    expect(streak("2026-10-14T19:59:00")).toEqual([]);
    expect(streak("2026-10-14T21:55:00")).toEqual(["Log today's charge before midnight to keep it going."]);
    expect(streak("2026-10-14T21:55:00", { sent: { streak: "2026-10-14" } })).toEqual([]);
    expect(streak("2026-10-14T22:00:00")).toEqual([]);
  });
});

describe("scheduler runs", () => {
  const realFetch = globalThis.fetch;
  let quiet: ReturnType<typeof spyOn> | undefined;
  beforeEach(() => {
    resetFakeRedis();
    pushes.length = 0;
    pushAnswer = () => undefined;
    // No grid provider in these runs: they're about what's sent, not the grid.
    globalThis.fetch = (async () => { throw new Error("offline in tests"); }) as unknown as typeof fetch;
    // Failed sends are expected here; keep their log line out of the output.
    quiet = spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { globalThis.fetch = realFetch; quiet?.mockRestore(); });

  // The keys are deliberately invalid, so a real web-push could never send.
  const subscribe = (now: number, extra: Partial<StoredSubscription> = {}) => saveSubscription(sub({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/run-test", keys: { p256dh: "p", auth: "a" } }, ...extra }), null, now);
  const sentTitles = () => pushes.map((push) => push.payload.title);

  test("the month-end result goes out on a 07:45 run on the 1st, and a second run doesn't repeat it", async () => {
    const first = ist("2026-11-01T07:45:00");
    await subscribe(first);
    fakeRedis.zsets.set("lb:2026-10:all", new Map([[LB_ID, 120.5], ["00000000-0000-4000-8000-000000000002", 300.5]]));
    fakeRedis.strings.set(`lb:member:${LB_ID}`, JSON.stringify({ name: "Asha", zone: "western", keyHash: "x", month: "2026-10", points: 120, co2Kg: 9.5, scoredAt: 0, updatedAt: 0 }));
    expect(await runPushSchedule(first)).toMatchObject({ sent: 1, failed: 0 });
    expect(pushes[0].payload).toMatchObject({ title: "October's leaderboard is final", tag: "zeroemit-month-end" });
    expect((await listSubscriptions())[0].sent.monthEnd).toBe("2026-11");
    expect(await runPushSchedule(ist("2026-11-01T08:10:00"))).toMatchObject({ sent: 0 });
    expect(await runPushSchedule(ist("2026-11-02T08:10:00"))).toMatchObject({ sent: 0 });
    expect(sentTitles()).toEqual(["October's leaderboard is final"]);
  });

  test("a run in quiet hours sends nothing, even with an evening push still due", async () => {
    await subscribe(ist("2026-10-18T22:05:00"), { week: { weekStart: "2026-10-12", charges: 2, co2Kg: 1, greenPercent: 50 } });
    expect(await runPushSchedule(ist("2026-10-18T22:05:00"))).toMatchObject({ skipped: "Quiet hours (10 pm – 7 am IST)" });
    expect(await runPushSchedule(ist("2026-10-18T21:40:00"))).toMatchObject({ sent: 1 });
    expect(sentTitles()).toEqual(["Your week in ZeroEmit"]);
    // An offline phone gets it only until 22:00, not up to an hour later.
    expect(pushes[0].options.TTL).toBe(20 * 60);
  });

  // A badge nudge is due every evening until it's delivered.
  const badge = { key: "green-10", hint: "1 more green charge to unlock Green Regular." };
  const refuse = (statusCode: number) => { pushAnswer = () => { throw Object.assign(new Error("refused"), { statusCode }); }; };
  const evening = (day: number, minutes: number) => ist(`2026-10-${String(day).padStart(2, "0")}T18:00:00`) + minutes * 60_000;

  test("a subscription the push service keeps refusing goes after 5 runs over 2 days, not on the first 403", async () => {
    await subscribe(evening(14, 0), { badge });
    refuse(403);
    for (const minutes of [0, 15, 30, 45, 60]) expect(await runPushSchedule(evening(14, minutes))).toMatchObject({ sent: 0, failed: 1 });
    // Five refusals in an hour: kept, since a broken server setup looks the same.
    expect((await listSubscriptions())[0].rejected).toEqual({ runs: 5, since: evening(14, 0) });
    await runPushSchedule(evening(15, 0));
    expect(await listSubscriptions()).toHaveLength(1);
    await runPushSchedule(evening(16, 0));
    expect(await listSubscriptions()).toEqual([]);
    expect(fakeRedis.hashes.get("push:state")?.size ?? 0).toBe(0);
  });

  test("a delivery resets the count, and other failures leave it as it was", async () => {
    await subscribe(evening(14, 0), { badge });
    refuse(400);
    await runPushSchedule(evening(14, 0));
    await runPushSchedule(evening(14, 15));
    refuse(503);
    await runPushSchedule(evening(14, 30));
    expect((await listSubscriptions())[0].rejected).toEqual({ runs: 2, since: evening(14, 0) });
    pushAnswer = () => undefined;
    expect(await runPushSchedule(evening(14, 45))).toMatchObject({ sent: 1 });
    expect((await listSubscriptions())[0].rejected).toBeUndefined();
  });

  test("a subscription the push service says is gone is removed at once", async () => {
    await subscribe(evening(14, 0), { badge });
    refuse(410);
    await runPushSchedule(evening(14, 0));
    expect(await listSubscriptions()).toEqual([]);
  });
});
