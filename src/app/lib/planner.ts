import { HOUR_MS, IST_OFFSET_MS, istDayKey, type ForecastPoint } from "./grid";

// The charge planner: given how much energy a driver needs, how fast their
// charger is and when the car has to be ready, the cleanest time to plug in.
// The grid curve is hourly (each point covers its whole hour), so a charge
// can start at any minute and its average is weighted by how long it spends
// in each hour.

// Common chargers in India, slowest first. `kw` is what reaches the battery,
// roughly: a portable 2-wheeler charger, the 15 A socket a car's portable
// charger uses, a home wallbox, and a public DC fast charger.
export const CHARGERS = [
  { key: "scooter", kw: 0.75, label: "Scooter or bike", detail: "Portable charger, about 0.75\u00a0kW" },
  { key: "socket", kw: 3.3, label: "Home socket", detail: "Car's portable charger, about 3.3\u00a0kW" },
  { key: "wallbox", kw: 7.2, label: "Wallbox", detail: "Wall-mounted AC charger, about 7.2\u00a0kW" },
  { key: "fast", kw: 30, label: "Fast charger", detail: "Public DC charger, about 30\u00a0kW" },
] as const;
export type ChargerKey = (typeof CHARGERS)[number]["key"];
export const DEFAULT_CHARGER: ChargerKey = "socket";
export const chargerKw = (key: ChargerKey) => CHARGERS.find((charger) => charger.key === key)!.kw;

export const MIN_PLAN_KWH = 0.5;
// Waiting has to be worth it: a later start must beat plugging in now by at
// least this much (gCO₂/kWh, and share of now's average), or the plan is now.
const MIN_GAIN = 10;
const MIN_GAIN_SHARE = 0.03;
export const MAX_PLAN_KWH = 150;
// Charging times are rounded up to this, so suggested times land on tidy minutes.
const STEP_MS = 5 * 60_000;

// How long adding `kwh` takes at `kw`, rounded up to 5 minutes. The slack
// keeps float noise (9.9 / 3.3 is 3.0000000000000004) from adding a step.
export function chargeDurationMs(kwh: number, kw: number) {
  return Math.ceil(((kwh / kw) * HOUR_MS) / STEP_MS - 1e-9) * STEP_MS;
}

// The average intensity from `from` to `to`, weighted by time in each hour;
// null when the curve doesn't cover all of it (past its end, or a gap).
export function averageBetween(points: ForecastPoint[], from: number, to: number): number | null {
  if (to <= from) return null;
  let weighted = 0;
  let covered = 0;
  for (const point of points) {
    const start = Date.parse(point.datetime);
    const overlap = Math.min(to, start + HOUR_MS) - Math.max(from, start);
    if (overlap <= 0) continue;
    weighted += point.carbonIntensity * overlap;
    covered += overlap;
  }
  // A millisecond of slack for points stamped a hair off the hour.
  return covered >= to - from - 1 ? weighted / covered : null;
}

// When the curve runs out: the end of its last hour.
export function curveEnd(points: ForecastPoint[]) {
  return points.length ? Date.parse(points[points.length - 1].datetime) + HOUR_MS : 0;
}

// The next time the clock reads `time` ("HH:MM", IST) after `now`: later
// today, or tomorrow once it has passed. Every place is in India and the
// curve is on IST, so the deadline is too.
export function nextOccurrence(time: string, now: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  const istMidnight = Math.floor((now + IST_OFFSET_MS) / (24 * HOUR_MS)) * 24 * HOUR_MS - IST_OFFSET_MS;
  const today = istMidnight + minutes * 60_000;
  return today > now ? today : today + 24 * HOUR_MS;
}

export type Plan =
  // `start`/`end`: when to plug in and when it's done. `nowAverage` is what
  // plugging in right away would average, to compare against.
  | { kind: "plan"; start: number; end: number; average: number; nowAverage: number; startsNow: boolean; durationMs: number; savedGrams: number; cleanerPercent: number }
  // Not enough time before the deadline: plugging in now adds `kwhByDeadline`.
  | { kind: "short"; durationMs: number; availableMs: number; kwhByDeadline: number }
  // The deadline is past the end of the curve, and so is the charge.
  | { kind: "beyond" }
  | { kind: "no-data" };

// The cleanest start for a `kwh` charge at `kw` that finishes by `readyBy`.
// The average over a fixed-length stretch of an hourly step curve is lowest
// with the start or the end on an hour boundary (or at a limit: now, or the
// latest start), so those are the only starts worth comparing. Ties go to the
// earlier start: the car is charged sooner for the same carbon.
export function planCharge({ points, now, kwh, kw, readyBy }: { points: ForecastPoint[]; now: number; kwh: number; kw: number; readyBy: number }): Plan {
  if (!points.length || !(kwh > 0) || !(kw > 0)) return { kind: "no-data" };
  const durationMs = chargeDurationMs(kwh, kw);
  const availableMs = readyBy - now;
  if (durationMs > availableMs) return { kind: "short", durationMs, availableMs: Math.max(0, availableMs), kwhByDeadline: Math.max(0, Math.floor((availableMs / HOUR_MS) * kw * 10) / 10) };
  const latestStart = Math.min(readyBy, curveEnd(points)) - durationMs;
  if (latestStart < now) return { kind: "beyond" };

  const boundaries = points.flatMap((point) => { const start = Date.parse(point.datetime); return [start, start + HOUR_MS]; });
  const starts = new Set([now, latestStart]);
  for (const boundary of boundaries) {
    for (const start of [boundary, boundary - durationMs]) if (start > now && start < latestStart) starts.add(start);
  }
  let best: { start: number; average: number } | null = null;
  for (const start of [...starts].sort((a, b) => a - b)) {
    const average = averageBetween(points, start, start + durationMs);
    // A tenth of a gram's difference is no reason to wait.
    if (average !== null && (!best || average < best.average - 0.1)) best = { start, average };
  }
  const nowAverage = averageBetween(points, now, now + durationMs);
  if (!best || nowAverage === null) return { kind: "no-data" };
  if (nowAverage - best.average < Math.max(MIN_GAIN, nowAverage * MIN_GAIN_SHARE)) best = { start: now, average: nowAverage };
  const startsNow = best.start === now;
  const savedGrams = startsNow ? 0 : Math.max(0, (nowAverage - best.average) * kwh);
  const cleanerPercent = startsNow || nowAverage <= 0 ? 0 : Math.max(0, Math.round(((nowAverage - best.average) / nowAverage) * 100));
  return { kind: "plan", start: best.start, end: best.start + durationMs, average: best.average, nowAverage, startsNow, durationMs, savedGrams, cleanerPercent };
}

// "5 h 15 min", "45 min", "2 h".
export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// A start in the small hours (10 pm to 6 am, IST): nobody should get up for
// it, so the plan says to set a charging timer before bed instead.
export function isNightStart(timestamp: number) {
  const hour = Math.floor(((timestamp + IST_OFFSET_MS) % (24 * HOUR_MS)) / HOUR_MS);
  return hour >= 22 || hour < 6;
}

// When to remind about a night start: 9:30 pm IST the evening before it.
export function bedtimeBefore(start: number) {
  const evening = nextOccurrence("21:30", start - 24 * HOUR_MS)!;
  return evening < start ? evening : evening - 24 * HOUR_MS;
}

// "today", "tonight" (6 pm onwards today), or "tomorrow", IST.
export function dayWord(timestamp: number, now: number) {
  if (istDayKey(timestamp) === istDayKey(now)) return Math.floor(((timestamp + IST_OFFSET_MS) % (24 * HOUR_MS)) / HOUR_MS) >= 18 ? "tonight" : "today";
  return istDayKey(timestamp) === istDayKey(now + 24 * HOUR_MS) ? "tomorrow" : "";
}
