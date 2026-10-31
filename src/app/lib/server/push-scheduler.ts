import { formatHour, formatWindow, HOUR_MS, IST_OFFSET_MS, IST_TIME_ZONE, istDayKey, istHourOfDay, mergeLiveReading, topWindows, type ForecastPoint } from "../grid";
import { istMonthKey } from "../leaderboard";
import { STATES, type Zone } from "../places";
import { GREEN_CHARGE_FALLBACK_THRESHOLD } from "../rewards";
import { getZoneSnapshot, isFresh, projectTypicalForecast } from "./grid-source";
import { boardStandings, type Standing } from "./leaderboard";
import { listSubscriptions, sendPush, updateSubscriptionState, type PushPayload, type SentMarkers, type StoredSubscription } from "./push";
import { forEachLimited } from "./pool";
import { redis } from "./redis";

const SEND_CONCURRENCY = 20;

// The provider's trial key allows 3 calls/minute and 100/day for the whole
// app, shared with live users. Each run refreshes at most this many regional
// grids from upstream, and only when the stored data is over an hour old (it
// only updates hourly anyway) — the typical pattern stays good for hours.
// With no runs in quiet hours, that's at most ~15 calls/day per region.
const UPSTREAM_BUDGET_PER_RUN = 2;
const REFRESH_AFTER_MS = 60 * 60_000;
// A "latest" reading older than this isn't treated as "right now".
const LIVE_MAX_AGE_MS = 90 * 60_000;
// Reminder fires once the window starts within this long. The scheduler runs
// about every 15 minutes but GitHub's scheduled runs can be late.
const REMINDER_LEAD_MS = 35 * 60_000;
// A daytime window only counts as "clean" if it's within this much of the
// day's cleanest daytime window — so once today's clean stretch has passed,
// the best of what's left (which may be dirty) isn't pushed as a good time.
const CLEAN_MARGIN = 1.1;

type ZonePlan = { points: ForecastPoint[]; dayFloor: number; liveIsGreen: boolean };

// Cleanest 2-hour daytime (07:00–23:00 IST) average in the typical pattern.
function daytimeFloor(pattern: (number | null)[]) {
  const known = pattern.filter((value): value is number => value !== null);
  const fallback = known.reduce((sum, value) => sum + value, 0) / (known.length || 1);
  let floor = Infinity;
  for (let h = 7; h <= 21; h += 1) floor = Math.min(floor, ((pattern[h] ?? fallback) + (pattern[h + 1] ?? fallback)) / 2);
  return floor;
}

async function loadZones(zones: Zone[]) {
  let budget = UPSTREAM_BUDGET_PER_RUN;
  const plans = new Map<Zone, ZonePlan>();
  for (const zone of zones) {
    const { snapshot, calledUpstream } = await getZoneSnapshot(zone, { allowUpstream: budget > 0, maxAgeMs: REFRESH_AFTER_MS });
    if (calledUpstream) budget -= 1;
    if (!snapshot?.pattern) continue;
    const live = snapshot.latest && isFresh(snapshot, LIVE_MAX_AGE_MS) ? snapshot.latest : null;
    const current = live ? { carbonIntensity: live.carbon_intensity_gco2_kwh, datetime: live.timestamp, isEstimated: true } : undefined;
    plans.set(zone, {
      points: mergeLiveReading({ forecast: projectTypicalForecast(snapshot.pattern), current }),
      dayFloor: daytimeFloor(snapshot.pattern),
      liveIsGreen: Boolean(live && (live.intensity_class ? live.intensity_class === "green" : live.carbon_intensity_gco2_kwh <= GREEN_CHARGE_FALLBACK_THRESHOLD)),
    });
  }
  return plans;
}

type MarkKey = Exclude<keyof SentMarkers, "badges">;
// `badge` is the badge key to record as nudged once it's delivered.
export type Planned = { payload: PushPayload; marks: MarkKey[]; badge?: string };
// This month's and (on the 1st) last month's leaderboard standing, loaded
// only for subscribers who joined and have "Leaderboard updates" on.
export type Standings = { current: Standing | null; lastMonth: Standing | null };

// "top" and "monthEnd" are once a month, so they record the month; the rest
// record the IST day.
const markValue = (mark: MarkKey, now: number) => (mark === "top" || mark === "monthEnd" ? istMonthKey(now) : istDayKey(now));
const LOG_ACTION = [{ action: "log", title: "Log a charge" }];
const BADGE_NUDGE_EVERY_DAYS = 3;

// Leaderboard news: last month's final result on the 1st, being overtaken
// (once a day), or reaching #1 (once a month). Also returns the rank to
// remember for next time.
function planLeaderboard(sub: StoredSubscription, standings: Standings, now: number) {
  const planned: Planned[] = [];
  const month = istMonthKey(now);
  const today = istDayKey(now);
  const hour = istHourOfDay(now);
  const { current, lastMonth } = standings;

  if (lastMonth && today.endsWith("-01") && hour >= 9 && hour < 12 && sub.sent.monthEnd !== month) {
    const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: IST_TIME_ZONE }).format(new Date(now - 24 * HOUR_MS));
    const co2 = lastMonth.co2Kg === null ? "" : `, with ${lastMonth.co2Kg.toFixed(1)} kg CO₂ avoided`;
    planned.push({ payload: { title: `${monthName}'s leaderboard is final`, body: `You finished #${lastMonth.rank} of ${lastMonth.total}${co2}. Share your result.`, url: "/profile?share=last-month", tag: "zeroemit-month-end" }, marks: ["monthEnd"] });
  }

  if (current) {
    // Only a rank seen this month, for this same leaderboard entry, compares.
    const remembered = sub.lb && sub.lb.month === month && sub.lb.leaderboardId === sub.leaderboardId ? sub.lb : null;
    if (remembered && current.rank > remembered.rank && sub.sent.overtake !== today) {
      // Name someone only if they're newly above you; otherwise a newcomer
      // higher up pushed everyone down, and the person above didn't move.
      const passedBy = current.above && current.aboveId !== remembered.aboveId ? current.above : null;
      const payload = passedBy
        ? { title: "You've been overtaken", body: `${passedBy} passed you on the leaderboard. You're now #${current.rank} this month.` }
        : { title: "Leaderboard update", body: `You dropped to #${current.rank} on the leaderboard this month.` };
      planned.push({ payload: { ...payload, url: "/rewards/leaderboard", tag: "zeroemit-leaderboard" }, marks: ["overtake"] });
    } else if (current.rank === 1 && current.total >= 2 && sub.sent.top !== month) {
      planned.push({ payload: { title: "Top of the leaderboard", body: "You're #1 on the leaderboard this month. Keep charging clean to stay there.", url: "/rewards/leaderboard", tag: "zeroemit-leaderboard" }, marks: ["top"] });
    }
  }

  const lb = current && sub.leaderboardId ? { month, rank: current.rank, aboveId: current.aboveId, leaderboardId: sub.leaderboardId } : sub.lb;
  return { planned, lb };
}

// Sunday-evening recap of the week, or on other evenings a nudge about the
// badge that's nearly unlocked (at most every few days per badge).
function planProgress(sub: StoredSubscription, now: number): Planned[] {
  const today = istDayKey(now);
  const hour = istHourOfDay(now);
  const sunday = new Date(now + IST_OFFSET_MS).getUTCDay() === 0;
  // This week's Monday: the device's totals count only if they're this week's.
  const monday = istDayKey(now - 6 * 24 * HOUR_MS);
  if (sunday && hour >= 18 && hour < 20 && sub.week?.weekStart === monday && sub.week.charges > 0 && sub.sent.weekly !== today) {
    const { charges, co2Kg, greenPercent } = sub.week;
    return [{ payload: { title: "Your week in ZeroEmit", body: `This week: ${charges} charge${charges === 1 ? "" : "s"}, ${co2Kg.toFixed(1)} kg CO₂ avoided, ${greenPercent}% green.`, url: "/profile", tag: "zeroemit-weekly" }, marks: ["weekly"] }];
  }
  const lastNudge = sub.badge ? sub.sent.badges?.[sub.badge.key] : undefined;
  const daysSince = lastNudge ? (Date.parse(today) - Date.parse(lastNudge)) / (24 * HOUR_MS) : Infinity;
  // The hint is from the device's last sync: a streak badge's "1 more day"
  // only holds while the streak is alive (a charge today or yesterday).
  const yesterday = istDayKey(now - 24 * HOUR_MS);
  const stillTrue = !sub.badge?.key.startsWith("streak-") || sub.lastChargeDay === today || sub.lastChargeDay === yesterday;
  // One evening push at most: none after this Sunday's recap went out.
  if (hour === 18 && sub.badge && stillTrue && daysSince >= BADGE_NUDGE_EVERY_DAYS && sub.sent.weekly !== today) {
    return [{ payload: { title: "Almost there", body: sub.badge.hint, url: "/rewards", tag: "zeroemit-badge" }, marks: [], badge: sub.badge.key }];
  }
  return [];
}

// Everything the scheduler wants to send one subscriber on this run, each
// with the "sent" markers to set once it's delivered, plus the leaderboard
// rank to remember. Nothing is sent between 22:00 and 06:59 IST.
export function plan(sub: StoredSubscription, zonePlan: ZonePlan | undefined, now: number, standings?: Standings): { planned: Planned[]; lb: StoredSubscription["lb"] } {
  const grid = planGrid(sub, zonePlan, now);
  const leaderboard = standings && sub.prefs.leaderboard ? planLeaderboard(sub, standings, now) : { planned: [], lb: sub.lb };
  const progress = sub.prefs.progress ? planProgress(sub, now) : [];
  return { planned: [...grid, ...leaderboard.planned, ...progress], lb: leaderboard.lb };
}

// The grid-based reminders: morning digest, best time today, tonight's best
// time, and the streak reminder.
function planGrid(sub: StoredSubscription, zonePlan: ZonePlan | undefined, now: number): Planned[] {
  const points = zonePlan?.points;
  const today = istDayKey(now);
  const tomorrow = istDayKey(now + 24 * HOUR_MS);
  const yesterday = istDayKey(now - 24 * HOUR_MS);
  const hour = istHourOfDay(now);
  const sent = { ...sub.sent };
  const planned: Planned[] = [];
  const near = `near ${sub.name}`;

  // Daytime windows start between now and 21:00 today (so they end by 23:00);
  // night windows start 22:00 today to 05:00 tomorrow.
  const dayWindow = points ? topWindows(points, 2, 1, (p) => istDayKey(p.datetime) === today && istHourOfDay(Date.parse(p.datetime)) <= 21)[0] : undefined;
  const nightWindow = points ? topWindows(points, 2, 1, (p) => { const h = istHourOfDay(Date.parse(p.datetime)); const d = istDayKey(p.datetime); return (d === today && h >= 22) || (d === tomorrow && h <= 5); })[0] : undefined;
  const startsNow = dayWindow && (dayWindow.start.isNow || Date.parse(dayWindow.start.datetime) <= now);
  const dayWindowIsClean = Boolean(dayWindow && zonePlan && (dayWindow.average <= zonePlan.dayFloor * CLEAN_MARGIN || (startsNow && dayWindow.start.isNow && zonePlan.liveIsGreen)));

  if (sub.prefs.dailyDigest && hour >= 7 && hour < 10 && sent.digest !== today && dayWindow) {
    planned.push({
      payload: {
        title: "Today's best time to charge",
        body: startsNow ? `Right now, ${near}: about ${Math.round(dayWindow.average)} gCO₂/kWh through ${formatHour(dayWindow.end.datetime)}.` : `${formatWindow(dayWindow)} ${near}, about ${Math.round(dayWindow.average)} gCO₂/kWh on average.`,
        url: "/forecast",
        tag: "zeroemit-digest",
      },
      // The digest already says it's charging time now — don't repeat it.
      marks: startsNow ? ["digest", "day"] : ["digest"],
    });
    sent.digest = today;
    if (startsNow) sent.day = today;
  }

  if (sub.prefs.bestTime && hour >= 7 && hour < 22 && sent.day !== today && dayWindow && dayWindowIsClean && (startsNow || Date.parse(dayWindow.start.datetime) - now <= REMINDER_LEAD_MS)) {
    planned.push({
      payload: {
        title: startsNow ? "Good time to charge now" : `Clean charging window at ${formatHour(dayWindow.start.datetime)}`,
        body: `The cleanest stretch left today ${near}: ${formatWindow(dayWindow)}, about ${Math.round(dayWindow.average)} gCO₂/kWh.`,
        url: "/",
        tag: "zeroemit-best-time",
        actions: LOG_ACTION,
      },
      marks: ["day"],
    });
  }

  if (sub.prefs.bestTime && hour === 21 && sent.night !== today && nightWindow) {
    planned.push({
      payload: {
        title: "Tonight's cleanest time to charge",
        body: `${formatWindow(nightWindow)} ${near}, about ${Math.round(nightWindow.average)} gCO₂/kWh. Set your charger to start then.`,
        url: "/forecast",
        tag: "zeroemit-night",
        actions: LOG_ACTION,
      },
      marks: ["night"],
    });
  }

  // Only when the streak is still alive (last charge yesterday) and today's
  // charge hasn't been logged yet.
  if (sub.prefs.streakReminders && hour >= 20 && hour < 22 && sent.streak !== today && sub.streak >= 2 && sub.lastChargeDay === yesterday) {
    planned.push({ payload: { title: `Keep your ${sub.streak}-day streak`, body: "Log today's charge before midnight to keep it going.", url: "/log", tag: "zeroemit-streak" }, marks: ["streak"] });
  }

  return planned;
}

// Every joined subscriber's standing from one read of this month's board
// (and, only while the month-end result can go out, last month's) — a few
// Redis commands per run however many subscribers there are. A failed
// lookup just skips leaderboard news this run.
async function loadBoards(subs: StoredSubscription[], now: number) {
  const ids = subs.filter((sub) => sub.leaderboardId && sub.prefs.leaderboard).map((sub) => sub.leaderboardId!);
  const hour = istHourOfDay(now);
  const monthEndWindow = istDayKey(now).endsWith("-01") && hour >= 9 && hour < 12;
  try {
    const [current, lastMonth] = await Promise.all([
      boardStandings(istMonthKey(now), ids),
      monthEndWindow ? boardStandings(istMonthKey(now - 24 * HOUR_MS), ids) : new Map<string, Standing>(),
    ]);
    return { current, lastMonth };
  } catch {
    return null;
  }
}

export async function runPushSchedule(now = Date.now()) {
  // Nothing is ever sent 22:00–06:59 IST, so don't spend provider quota then.
  const hour = istHourOfDay(now);
  if (hour < 7 || hour >= 22) return { skipped: "Quiet hours (10 pm – 7 am IST)" };
  // GitHub Actions and the Vercel cron can overlap; only one run at a time.
  const lock = await redis<string | null>("SET", "push:run-lock", String(now), "NX", "EX", 110);
  if (lock === null) return { skipped: "Another run is in progress" };
  try {
    const subs = await listSubscriptions();
    if (!subs.length) return { subscriptions: 0, sent: 0 };
    const zones = [...new Set(subs.map((sub) => STATES[sub.state]?.zone).filter(Boolean))] as Zone[];
    const plansByZone = await loadZones(zones);
    let sent = 0;
    let failed = 0;
    const today = istDayKey(now);
    const boards = await loadBoards(subs, now);
    // Subscribers in parallel (each one's own pushes stay in order), so a few
    // hundred finish well inside the function's time limit.
    await forEachLimited(subs, SEND_CONCURRENCY, async (sub) => {
      const standings = boards && sub.leaderboardId && sub.prefs.leaderboard ? { current: boards.current.get(sub.leaderboardId) ?? null, lastMonth: boards.lastMonth.get(sub.leaderboardId) ?? null } : undefined;
      const { planned, lb } = plan(sub, plansByZone.get(STATES[sub.state]?.zone), now, standings);
      const markers: SentMarkers = { ...sub.sent, badges: { ...sub.sent.badges } };
      let gone = false;
      for (const { payload, marks, badge } of planned) {
        // Stop at the first failure: an expired subscription was already
        // removed, and anything undelivered is retried on the next run.
        const result = await sendPush(sub, payload);
        if (result !== "sent") { failed += 1; gone = result === "gone"; break; }
        sent += 1;
        for (const mark of marks) markers[mark] = markValue(mark, now);
        if (badge) markers.badges = { ...markers.badges, [badge]: today };
      }
      // Its state went with it; writing it back would leave an orphan entry.
      if (gone) return;
      if (!Object.keys(markers.badges ?? {}).length) delete markers.badges;
      // Keep the old rank while an overtake notice is still undelivered, or
      // the next run would see no change and never send it.
      const overtakeUndelivered = planned.some(({ marks }) => marks.includes("overtake")) && markers.overtake === sub.sent.overtake;
      const nextLb = overtakeUndelivered ? sub.lb : lb;
      if (JSON.stringify(markers) !== JSON.stringify(sub.sent) || JSON.stringify(nextLb) !== JSON.stringify(sub.lb)) await updateSubscriptionState(sub, { sent: markers, lb: nextLb });
    });
    if (failed) console.error(`push schedule: ${failed} of ${subs.length} subscribers had a failed send`);
    return { subscriptions: subs.length, zones: zones.length, sent, failed };
  } finally {
    await redis("DEL", "push:run-lock").catch(() => undefined);
  }
}
