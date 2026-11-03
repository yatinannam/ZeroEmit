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
// the day's average. A window can start at any hour, 11 pm included (running
// on to midnight), just as the app's recommended windows can (topWindows in
// lib/grid.ts), so both rank the same candidate windows.
export function chargeTiming(pattern: (number | null)[], hour: number): ChargeTiming {
  const known = pattern.filter((value): value is number => value !== null);
  if (!known.length) return "other";
  const average = known.reduce((sum, value) => sum + value, 0) / known.length;
  const at = (h: number) => pattern[h % 24] ?? average;
  const windows = Array.from({ length: 24 }, (_, start) => ({ start, average: (at(start) + at(start + 1)) / 2 }))
    .sort((a, b) => a.average - b.average || a.start - b.start);
  // Hours apart around the clock: 11 pm and midnight are 1 apart, not 23.
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
  const picked: number[] = [];
  for (const window of windows) {
    if (picked.length >= BEST_WINDOWS) break;
    if (picked.every((start) => apart(start, window.start) >= WINDOW_HOURS)) picked.push(window.start);
  }
  if (picked.some((start) => (hour - start + 24) % 24 < WINDOW_HOURS)) return "best";
  return at(hour) < average ? "cleaner" : "other";
}

// Whether a window starting at `hour` (IST) is one of the day's cleanest —
// i.e. charging then earns the "best" timing bonus.
export function isBestWindowStart(pattern: (number | null)[] | null, hour: number) {
  return Boolean(pattern?.some((value) => value !== null)) && chargeTiming(pattern!, hour) === "best";
}

const pad = (value: number) => String(value).padStart(2, "0");
// "YYYY-MM-DD" and "HH:MM" on the device's own clock, as date/time inputs use.
export const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// Where the log-a-charge form starts: the usual charge time ("HH:MM") on the
// last day it has already come round — today once it's passed, otherwise
// yesterday (usual 22:30 at 07:45 is most likely last night's charge). With
// no usual time, right now.
export function defaultChargeMoment(typicalTime: string | null, now: Date): { date: string; time: string } {
  const [hours, minutes] = (typicalTime ?? "").split(":").map(Number);
  if (!typicalTime || !Number.isInteger(hours) || !Number.isInteger(minutes)) return { date: localDate(now), time: localTime(now) };
  // Padded, since a time input only takes "09:30", not "9:30".
  const time = `${pad(hours)}:${pad(minutes)}`;
  if (hours * 60 + minutes <= now.getHours() * 60 + now.getMinutes()) return { date: localDate(now), time };
  return { date: localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)), time };
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
