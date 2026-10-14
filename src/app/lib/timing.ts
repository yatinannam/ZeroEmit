import { istHourOfDay, type ForecastPoint } from "./grid";

// How well a charge was timed against its region's typical day: in one of
// the day's 3 cleanest 2-hour windows (what the app recommends), at an hour
// cleaner than the day's average, or neither. India's grid rarely drops
// below an absolute "green" level, so points reward timing relative to the
// region instead — achievable everywhere, and exactly what the app advises.
export type ChargeTiming = "best" | "cleaner" | "other";
export const TIMING_BONUS: Record<ChargeTiming, number> = { best: 10, cleaner: 5, other: 0 };
export const CHARGE_TIMINGS = Object.keys(TIMING_BONUS) as ChargeTiming[];

const BEST_WINDOWS = 3;
const WINDOW_HOURS = 2;

// `pattern` holds a value per IST hour (0–23); hours without data count at
// the day's average.
export function chargeTiming(pattern: (number | null)[], hour: number): ChargeTiming {
  const known = pattern.filter((value): value is number => value !== null);
  if (!known.length) return "other";
  const average = known.reduce((sum, value) => sum + value, 0) / known.length;
  const at = (h: number) => pattern[h] ?? average;
  const windows = Array.from({ length: 24 - WINDOW_HOURS + 1 }, (_, start) => ({ start, average: (at(start) + at(start + 1)) / 2 }))
    .sort((a, b) => a.average - b.average || a.start - b.start);
  const picked: number[] = [];
  for (const window of windows) {
    if (picked.length >= BEST_WINDOWS) break;
    if (picked.every((start) => Math.abs(start - window.start) >= WINDOW_HOURS)) picked.push(window.start);
  }
  if (picked.some((start) => hour >= start && hour < start + WINDOW_HOURS)) return "best";
  return at(hour) < average ? "cleaner" : "other";
}

// A forecast (typical or live) read into values by IST hour of day; the
// first point for each hour wins, hours it doesn't cover are null.
export function hourlyPattern(forecast: ForecastPoint[]): (number | null)[] {
  const pattern: (number | null)[] = Array(24).fill(null);
  for (const point of forecast) {
    const hour = istHourOfDay(Date.parse(point.datetime));
    if (pattern[hour] === null) pattern[hour] = point.carbonIntensity;
  }
  return pattern;
}
