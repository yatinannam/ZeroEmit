import type { Charge } from "../components/use-charges";
import { istDayKey } from "./grid";
import { ZONE_LABELS, type Zone } from "./places";
import { GREEN_CHARGE_BONUS, isGreenCharge, MAX_CHARGE_KWH, POINTS_PER_CHARGE, UNTIMED_CHARGE_BASELINE } from "./rewards";

// Rules shared by the app (building what it sends) and the server (which
// recomputes the score itself rather than trusting a number from the client).
export const MAX_COUNTED_PER_DAY = 2;
export const MAX_SUBMITTED_CHARGES = 100;
export const MAX_INTENSITY = 2000;
export const LEADERBOARD_SIZE = 50;
export const ZONES = Object.keys(ZONE_LABELS) as Zone[];

export type LeaderboardCharge = { date: string; kwh: number; intensity: number | null; green: boolean };
export type LeaderboardScope = "all" | Zone;
export type LeaderboardRow = { rank: number; name: string; zone: Zone; points: number; co2Kg: number; isMe: boolean };
export type LeaderboardResponse = { month: string; total: number; rows: LeaderboardRow[]; me: LeaderboardRow | null };

export const istMonthKey = (date: string | number | Date) => istDayKey(date).slice(0, 7);

// This IST month's charges, newest first (the order useCharges keeps), as the
// little the server needs to score them.
export function toLeaderboardCharges(charges: Charge[], month: string): LeaderboardCharge[] {
  return charges
    .filter((charge) => istMonthKey(charge.loggedAt) === month)
    .slice(0, MAX_SUBMITTED_CHARGES)
    .map((charge) => ({ date: istDayKey(charge.loggedAt), kwh: charge.energyKwh, intensity: charge.carbonIntensity, green: isGreenCharge(charge) }));
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Points and CO2 avoided for `month` ("YYYY-MM"), counting days up to `today`
// ("YYYY-MM-DD") and at most the best MAX_COUNTED_PER_DAY charges a day —
// charges are self-reported, so this bounds what logging fake ones can earn.
export function scoreMonth(entries: LeaderboardCharge[], month: string, today: string): { points: number; co2Kg: number } {
  const byDay = new Map<string, { points: number; grams: number }[]>();
  for (const entry of entries) {
    if (!entry.date.startsWith(`${month}-`) || entry.date > today) continue;
    const kwh = clamp(entry.kwh, 0, MAX_CHARGE_KWH);
    const intensity = entry.intensity === null ? null : clamp(entry.intensity, 0, MAX_INTENSITY);
    const points = POINTS_PER_CHARGE + (entry.green && intensity !== null ? GREEN_CHARGE_BONUS : 0);
    const grams = intensity === null ? 0 : Math.max(0, UNTIMED_CHARGE_BASELINE - intensity) * kwh;
    const day = byDay.get(entry.date) ?? [];
    day.push({ points, grams });
    byDay.set(entry.date, day);
  }
  let points = 0;
  let grams = 0;
  for (const day of byDay.values()) {
    day.sort((a, b) => b.points - a.points || b.grams - a.grams);
    for (const charge of day.slice(0, MAX_COUNTED_PER_DAY)) { points += charge.points; grams += charge.grams; }
  }
  return { points, co2Kg: Math.round(grams / 100) / 10 };
}

// Built at runtime: TypeScript rejects \p{…} in a regex literal at this
// project's ES2017 target. \p{M} covers combining marks, e.g. the vowel
// signs in Devanagari names.
const NAME_PATTERN = new RegExp("^[\\p{L}\\p{M}\\p{N}]+( [\\p{L}\\p{M}\\p{N}]+)*$", "u");
// Whole words only, so names like "Dickens" or "Lundgren" pass…
const BLOCKED_WORDS = new Set(["fuck", "fucker", "shit", "bitch", "bastard", "cunt", "dick", "asshole", "slut", "whore", "nigger", "chutiya", "madarchod", "bhenchod", "behenchod", "gandu", "randi", "bsdk", "lund", "harami", "porn", "sex"]);
// …while these are blocked anywhere in the name, ignoring case and spacing.
const BLOCKED_ANYWHERE = ["fuck", "nigger", "madarchod", "bhenchod", "behenchod", "chutiya"];

export function validateDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20 || !NAME_PATTERN.test(name)) return null;
  const lower = name.toLowerCase();
  if (lower.split(" ").some((word) => BLOCKED_WORDS.has(word))) return null;
  const squashed = lower.replace(/[^a-z]/g, "");
  return BLOCKED_ANYWHERE.some((word) => squashed.includes(word)) ? null : name;
}
