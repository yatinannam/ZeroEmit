// `isNow` marks the point covering the current hour once the live reading has
// been merged into it (see planByDay) — the rest of the curve is forecast.
export type ForecastPoint = { datetime: string; carbonIntensity: number; isNow?: boolean };
// `forecastIsTypical` marks a forecast built from an average of real
// historical readings per hour-of-day (used when a live forecast isn't
// available, e.g. it needs a paid plan) rather than an actual live forecast.
// `state` is the state slug the data was requested for (see lib/places.ts).
export type GridData = { available: boolean; state: string; current?: { carbonIntensity: number; datetime: string; isEstimated: boolean; intensityClass?: string }; forecast: ForecastPoint[]; forecastIsTypical?: boolean; updatedAt?: string; source: string; error?: string };

// Every supported city is in India, and the typical pattern is bucketed by IST
// hour — so "today", "tomorrow" and every displayed clock time use IST too,
// whatever timezone the viewing device happens to be set to.
export const IST_TIME_ZONE = "Asia/Kolkata";
export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;
export const IST_OFFSET_MS = 5.5 * HOUR_MS; // IST has no DST, so a fixed offset is exact

export function istDayKey(datetime: string | number | Date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: IST_TIME_ZONE }).format(new Date(datetime));
}

export function istHourStart(timestamp: number) {
  return Math.floor((timestamp + IST_OFFSET_MS) / HOUR_MS) * HOUR_MS - IST_OFFSET_MS;
}

export type ChargeWindow = { start: ForecastPoint; end: ForecastPoint; average: number; startIndex: number };

// Every possible `hours`-long window ranked cleanest-first, skipping windows
// that overlap one already picked so the list shows genuinely distinct times
// rather than the same low patch shifted by an hour. `startsIn` limits which
// points a window may *start* on (e.g. "today") while still letting it run
// past midnight into the next day's points.
export function topWindows(forecast: ForecastPoint[], hours = 2, count = 3, startsIn: (point: ForecastPoint) => boolean = () => true): ChargeWindow[] {
  if (forecast.length < hours) return [];
  const candidates: ChargeWindow[] = [];
  for (let index = 0; index <= forecast.length - hours; index += 1) {
    if (!startsIn(forecast[index])) continue;
    const window = forecast.slice(index, index + hours);
    const average = window.reduce((sum, point) => sum + point.carbonIntensity, 0) / hours;
    const end = forecast[index + hours] || { ...window[hours - 1], isNow: false, datetime: new Date(new Date(window[hours - 1].datetime).getTime() + HOUR_MS).toISOString() };
    candidates.push({ start: window[0], end, average, startIndex: index });
  }
  candidates.sort((a, b) => a.average - b.average);
  const picked: ChargeWindow[] = [];
  for (const candidate of candidates) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.startIndex - candidate.startIndex) < hours)) continue;
    picked.push(candidate);
  }
  return picked;
}

export type DayPlan = { points: ForecastPoint[]; windows: ChargeWindow[] };

// The forecast starts at (or after) the current hour, so on its own it never
// considers charging *right now* — and the live reading is often far cleaner
// than the forecast/typical value for this hour. Merge the live reading into
// the point covering now (adding one if the forecast starts later) and drop
// any already-past points. Also used by the server's push scheduler.
export function mergeLiveReading(data: Pick<GridData, "forecast" | "current">, now = Date.now()): ForecastPoint[] {
  let merged = data.forecast.filter((point) => new Date(point.datetime).getTime() + HOUR_MS > now);
  if (data.current) {
    const live = { carbonIntensity: data.current.carbonIntensity, isNow: true };
    const coversNow = merged[0] && new Date(merged[0].datetime).getTime() <= now;
    merged = coversNow ? [{ ...merged[0], ...live }, ...merged.slice(1)] : [{ datetime: new Date(istHourStart(now)).toISOString(), ...live }, ...merged];
  }
  return merged;
}

// How long a live reading can stand for "right now". The server only passes
// on a reading from a snapshot under 90 minutes old, but the provider's
// newest complete hour already trails the clock (the hour still being filled
// in is skipped), so a current reading's own stamp can be a couple of hours
// old. Past this, a page left open for hours (or kept on its last good data
// while offline) stops calling an old reading "Now".
export const LIVE_READING_MAX_AGE_MS = 3 * HOUR_MS;

// Whether a live reading can stand for the grid at `timestamp`: from an hour
// before its stamp (providers can stamp a reading slightly ahead of the
// clock) until it's LIVE_READING_MAX_AGE_MS old.
export function readingCovers(current: { datetime: string }, timestamp: number) {
  const age = timestamp - Date.parse(current.datetime);
  return age > -HOUR_MS && age < LIVE_READING_MAX_AGE_MS;
}

// The live reading, while it's still recent enough to call "right now".
export function liveReading(data: GridData | null | undefined, now = Date.now()) {
  return data?.available && data.current && readingCovers(data.current, now) ? data.current : undefined;
}

// Split into IST "today" and "tomorrow" windows.
export function planByDay(data: GridData | null | undefined): { today: DayPlan; tomorrow: DayPlan } {
  const empty = { today: { points: [], windows: [] }, tomorrow: { points: [], windows: [] } };
  if (!data?.available) return empty;
  const now = Date.now();
  // An old reading isn't "Now": without a recent one the forecast stands alone.
  const merged = mergeLiveReading({ forecast: data.forecast, current: liveReading(data, now) }, now);
  const todayKey = istDayKey(now);
  const tomorrowKey = istDayKey(now + 24 * HOUR_MS);
  const plan = (key: string) => ({
    points: merged.filter((point) => istDayKey(point.datetime) === key),
    windows: topWindows(merged, 2, 3, (point) => istDayKey(point.datetime) === key),
  });
  return { today: plan(todayKey), tomorrow: plan(tomorrowKey) };
}

export const istHourOfDay = (timestamp: number) => Math.floor(((timestamp + IST_OFFSET_MS) % (24 * HOUR_MS)) / HOUR_MS);

// Grid intensity for when a charge actually happened (not when it was logged):
// the live reading if it was taken around then (judged against the reading's
// own time, not the clock — data loaded hours ago isn't live for a charge
// now); otherwise, for a typical-pattern forecast (which spans every hour of
// the day), the typical value for that hour. A live forecast only covers the
// future, so a past hour gets null — no reading beats a guessed one for
// points and CO₂ math.
export function intensityAt(data: GridData | null | undefined, timestamp: number): { carbonIntensity: number; intensityClass: string | null; source: "live" | "typical" } | null {
  if (!data?.available) return null;
  if (data.current && readingCovers(data.current, timestamp)) return { carbonIntensity: data.current.carbonIntensity, intensityClass: data.current.intensityClass ?? null, source: "live" };
  if (!data.forecastIsTypical) return null;
  const match = data.forecast.find((point) => istHourOfDay(new Date(point.datetime).getTime()) === istHourOfDay(timestamp));
  return match ? { carbonIntensity: match.carbonIntensity, intensityClass: null, source: "typical" } : null;
}

export function formatHour(datetime: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST_TIME_ZONE }).format(new Date(datetime));
}

// When the data was last updated: "6:00 pm" today, "yesterday, 6:00 pm", or
// "1 Nov, 6:00 pm" further back (IST days), so a snapshot from yesterday
// evening doesn't pass for this evening's. Providers stamp the latest reading
// with the hour it's for, which can be slightly ahead of the real clock —
// never show an "updated" time in the future.
export function formatUpdatedAt(iso: string, now = Date.now()) {
  const time = Math.min(Date.parse(iso), now);
  if (Number.isNaN(time)) return "";
  const clock =new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST_TIME_ZONE }).format(time);
  if (istDayKey(time) === istDayKey(now)) return clock;
  if (istDayKey(time) === istDayKey(now - DAY_MS)) return `yesterday, ${clock}`;
  return `${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: IST_TIME_ZONE }).format(time)}, ${clock}`;
}

// "1 pm" — compact enough for chart axis ticks.
export function formatShortHour(datetime: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", timeZone: IST_TIME_ZONE }).format(new Date(datetime));
}

// A window starting in the current hour began before now, so its start time
// ("12:00 pm" at 12:40) would read as already past — show it as "Now".
export function formatWindow(window: ChargeWindow) {
  return `${window.start.isNow ? "Now" : formatHour(window.start.datetime)} – ${formatHour(window.end.datetime)}`;
}

// Splits out the am/pm so callers can render it smaller than the hour —
// at the hero size the full locale string ("12:16 pm") is wide enough to wrap.
export function formatHourParts(datetime: string) {
  const parts = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST_TIME_ZONE }).formatToParts(new Date(datetime));
  const time = parts.filter((part) => part.type !== "dayPeriod").map((part) => part.value).join("").trim();
  const period = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  return { time, period };
}
