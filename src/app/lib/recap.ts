import type { Charge } from "../components/use-charges";
import { chargeCost, DEFAULT_PRICE_PER_KWH } from "./cost";
import { impactEquivalents } from "./equivalents";
import { IST_OFFSET_MS, IST_TIME_ZONE } from "./grid";
import { istMonthKey } from "./leaderboard";
import { achievements, currentRewardTier, estimatedCarbonSavedGrams, longestStreakDays, totalPoints } from "./rewards";

// The monthly (or yearly) recap: a story of how a stretch of charging went,
// built on the device from its own charge history. Periods are IST months
// ("2026-10") or years ("2026"), like the leaderboard's.
export type RecapPeriod = { key: string; label: string; kind: "month" | "year" };
export type TimingCounts = { best: number; cleaner: number; other: number; untimed: number };
export type Recap = {
  period: RecapPeriod;
  count: number;
  kwh: number;
  cost: number;
  co2Kg: number;
  equivalents: ReturnType<typeof impactEquivalents>;
  points: number;
  timing: TimingCounts;
  // Share (0–1) of charges in a best window, of those with timing; null if none had it.
  bestShare: number | null;
  // The same share the period before, to compare; null without one.
  previousBestShare: number | null;
  cleanest: { loggedAt: string; chargedAt: string; intensity: number; city: string } | null;
  averageIntensity: number | null;
  usualTime: string | null;
  busiestWeekday: string | null;
  longestStreak: number;
  cities: number;
  // Badges first unlocked in the period, and the level at its end.
  newBadges: string[];
  level: string;
  levelUp: boolean;
};

const LEGACY_YEAR = "1970";
const monthKeyOf = (charge: Charge) => istMonthKey(charge.loggedAt);
const inPeriod = (key: string) => (charge: Charge) => (key.length === 4 ? monthKeyOf(charge).startsWith(`${key}-`) : monthKeyOf(charge) === key);

export function periodLabel(key: string) {
  if (key.length === 4) return key;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: IST_TIME_ZONE }).format(Date.parse(`${key}-15T12:00:00+05:30`));
}

// "October" or "2026": what the recap calls its period in sentences.
export const shortPeriodLabel = (period: RecapPeriod) => (period.kind === "year" ? period.key : periodLabel(period.key).replace(/ \d{4}$/, ""));

export const isPeriodKey = (value: unknown): value is string => typeof value === "string" && /^(\d{4})(-(0[1-9]|1[0-2]))?$/.test(value);

// Every month with a charge, newest first, then every year with charges in
// more than one month (a year of one month says nothing a month doesn't).
export function recapPeriods(charges: Charge[]): RecapPeriod[] {
  const months = [...new Set(charges.map(monthKeyOf))].filter((key) => !key.startsWith(LEGACY_YEAR)).sort().reverse();
  const years = [...new Set(months.map((key) => key.slice(0, 4)))].filter((year) => months.filter((key) => key.startsWith(year)).length > 1);
  return [...months.map((key) => ({ key, label: periodLabel(key), kind: "month" as const })), ...years.map((key) => ({ key, label: key, kind: "year" as const }))];
}

// Which recap to open with no period asked for: last month in the first
// week of a month (the recap people come for), otherwise this month so far,
// otherwise the latest month with charges.
export function defaultPeriod(periods: RecapPeriod[], now: number): string | null {
  const months = periods.filter((period) => period.kind === "month").map((period) => period.key);
  if (!months.length) return null;
  const thisMonth = istMonthKey(now);
  const lastMonth = istMonthKey(Date.parse(`${thisMonth}-01T00:00:00+05:30`) - 1);
  const dayOfMonth = new Date(now + IST_OFFSET_MS).getUTCDate();
  if (dayOfMonth <= 7 && months.includes(lastMonth)) return lastMonth;
  if (months.includes(thisMonth)) return thisMonth;
  return months[0];
}

// The period before `key`: the month before, or the year before.
export function previousPeriod(key: string) {
  if (key.length === 4) return String(Number(key) - 1);
  return istMonthKey(Date.parse(`${key}-01T00:00:00+05:30`) - 1);
}

// The hour most charges started in ("23:00"), only when it holds at least
// two charges and clearly beats every other hour: "usually" has to be true.
function usualHour(charges: Charge[]) {
  const counts = new Map<number, number>();
  for (const charge of charges) {
    const hour = Number(/^(\d{1,2}):/.exec(charge.chargedAt)?.[1]);
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2 || (ranked[1] && ranked[1][1] === ranked[0][1])) return null;
  return `${String(ranked[0][0]).padStart(2, "0")}:00`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function busiestWeekday(charges: Charge[]) {
  if (charges.length < 3) return null;
  const counts = new Array(7).fill(0);
  for (const charge of charges) counts[new Date(Date.parse(charge.loggedAt) + IST_OFFSET_MS).getUTCDay()] += 1;
  const top = Math.max(...counts);
  // Only a clear favourite: a tie says nothing about a habit.
  return counts.filter((count) => count === top).length === 1 ? WEEKDAYS[counts.indexOf(top)] : null;
}

function timingCounts(charges: Charge[]): TimingCounts {
  const counts: TimingCounts = { best: 0, cleaner: 0, other: 0, untimed: 0 };
  for (const charge of charges) counts[charge.timing ?? "untimed"] += 1;
  return counts;
}

const shareBest = (counts: TimingCounts) => {
  const timed = counts.best + counts.cleaner + counts.other;
  return timed ? counts.best / timed : null;
};

// The recap for `key`, or null with no charges in it. `pricePerKwh` is the
// driver's own price for the cost line.
export function buildRecap(all: Charge[], key: string, pricePerKwh = DEFAULT_PRICE_PER_KWH): Recap | null {
  const charges = all.filter(inPeriod(key));
  if (!charges.length) return null;
  const period: RecapPeriod = { key, label: periodLabel(key), kind: key.length === 4 ? "year" : "month" };
  const kwh = charges.reduce((sum, charge) => sum + charge.energyKwh, 0);
  const co2Kg = estimatedCarbonSavedGrams(charges) / 1000;
  const timing = timingCounts(charges);
  const previous = all.filter(inPeriod(previousPeriod(key)));
  const measured = charges.filter((charge): charge is Charge & { carbonIntensity: number } => charge.carbonIntensity !== null);
  const cleanest = measured.reduce<(typeof measured)[number] | null>((best, charge) => (!best || charge.carbonIntensity < best.carbonIntensity ? charge : best), null);

  // Badges and level from everything up to the end of the period, against
  // everything before it began (the streak badges use the best streak).
  const isBefore = (charge: Charge) => (key.length === 4 ? monthKeyOf(charge).slice(0, 4) < key : monthKeyOf(charge) < key);
  const before = all.filter(isBefore);
  const through = all.filter((charge) => isBefore(charge) || inPeriod(key)(charge));
  const unlockedBefore = new Set(achievements(before, 0).filter((badge) => badge.unlocked).map((badge) => badge.key));
  const newBadges = achievements(through, 0).filter((badge) => badge.unlocked && !unlockedBefore.has(badge.key)).map((badge) => badge.title);
  const levelBefore = currentRewardTier(totalPoints(before)).current;
  const levelAfter = currentRewardTier(totalPoints(through)).current;

  return {
    period,
    count: charges.length,
    kwh,
    cost: chargeCost(kwh, pricePerKwh),
    co2Kg,
    equivalents: impactEquivalents(co2Kg),
    points: totalPoints(charges),
    timing,
    bestShare: shareBest(timing),
    previousBestShare: previous.length ? shareBest(timingCounts(previous)) : null,
    cleanest: cleanest ? { loggedAt: cleanest.loggedAt, chargedAt: cleanest.chargedAt, intensity: cleanest.carbonIntensity, city: cleanest.city } : null,
    averageIntensity: measured.length ? measured.reduce((sum, charge) => sum + charge.carbonIntensity, 0) / measured.length : null,
    usualTime: usualHour(charges),
    busiestWeekday: busiestWeekday(charges),
    longestStreak: longestStreakDays(charges),
    cities: new Set(charges.map((charge) => charge.city)).size,
    newBadges,
    level: levelAfter.name,
    levelUp: levelAfter.threshold > levelBefore.threshold,
  };
}

