import { formatHour, formatWindow, HOUR_MS, istDayKey, istHourOfDay, mergeLiveReading, topWindows, type ForecastPoint } from "../grid";
import { STATES, type Zone } from "../places";
import { GREEN_CHARGE_FALLBACK_THRESHOLD } from "../rewards";
import { getZoneSnapshot, isFresh, projectTypicalForecast } from "./grid-source";
import { listSubscriptions, sendPush, updateSentMarkers, type PushPayload, type SentMarkers, type StoredSubscription } from "./push";
import { redis } from "./redis";

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

type Planned = { payload: PushPayload; marks: (keyof SentMarkers)[] };

// Everything the scheduler wants to send one subscriber on this run, each
// with the "sent today" markers to set once it's delivered.
// Nothing is sent between 22:00 and 06:59 IST.
function plan(sub: StoredSubscription, zonePlan: ZonePlan | undefined, now: number): Planned[] {
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
    for (const sub of subs) {
      const planned = plan(sub, plansByZone.get(STATES[sub.state]?.zone), now);
      if (!planned.length) continue;
      const markers: SentMarkers = { ...sub.sent };
      for (const { payload, marks } of planned) {
        // Stop at the first failure: an expired subscription was already
        // removed, and anything undelivered is retried on the next run.
        if (!(await sendPush(sub, payload))) { failed += 1; break; }
        sent += 1;
        for (const mark of marks) markers[mark] = today;
      }
      if (JSON.stringify(markers) !== JSON.stringify(sub.sent)) await updateSentMarkers(sub, markers);
    }
    return { subscriptions: subs.length, zones: zones.length, sent, failed };
  } finally {
    await redis("DEL", "push:run-lock").catch(() => undefined);
  }
}
