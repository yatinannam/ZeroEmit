import type { Charge } from "../components/use-charges";
import { TIMING_BONUS, type ChargeTiming } from "./timing";
import { DAY_MS, IST_OFFSET_MS, istHourOfDay } from "./grid";

export const POINTS_PER_CHARGE = 10;
// Fallback only — used when a charge has no provider intensity_class (older
// charges, or a provider that doesn't classify tiers). India's real grid
// intensity commonly runs 650-800 gCO2/kWh with "yellow" starting around
// 476 (observed from the live India Energy Atlas zone data this app uses),
// so a fixed cutoff well below that approximates what "green" would mean.
export const GREEN_CHARGE_FALLBACK_THRESHOLD = 450; // gCO2/kWh
// The old bonus, kept for charges logged before timing was recorded.
export const GREEN_CHARGE_BONUS = 5;
// Largest charge the log form accepts; the leaderboard clamps to it too.
// Comfortably above the largest EV battery sold in India (~100 kWh) — a
// typo like 1800 would otherwise inflate every total and become the next
// form's "typical" default.
export const MAX_CHARGE_KWH = 150;
// Smallest charge the log form accepts: a charge is kept to 0.1 kWh.
export const MIN_CHARGE_KWH = 0.1;

// What's wrong with an energy figure typed into the log form, said so the
// driver can fix it, or null when it can be saved. More than one decimal is
// fine: the charge is rounded to 0.1 kWh.
export function chargeEnergyError(raw: string): string | null {
  if (!raw.trim()) return "Enter the energy added, in kWh.";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter the energy as a number, like 18.5.";
  if (value < MIN_CHARGE_KWH) return `Enter at least ${MIN_CHARGE_KWH} kWh.`;
  if (value > MAX_CHARGE_KWH) return `Enter ${MAX_CHARGE_KWH} kWh or less, the most one charge can add.`;
  return null;
}
// Below this a charge earns no points or timing bonus and counts toward no
// badge or leaderboard score: a 0.1 kWh "charge" logged for points is easy to
// repeat. It still counts in energy totals and streaks.
export const MIN_POINTS_KWH = 2;
export const earnsPoints = (charge: Pick<Charge, "energyKwh">) => charge.energyKwh >= MIN_POINTS_KWH;

// The grid's absolute rating, which is how charges were judged before their
// timing was recorded.
function legacyGreen(charge: Charge): boolean {
  return charge.intensityClass
    ? charge.intensityClass === "green"
    : charge.carbonIntensity !== null && charge.carbonIntensity <= GREEN_CHARGE_FALLBACK_THRESHOLD;
}

// The charge's timing when it's one the app writes. Anything else (a
// hand-edited "superb" or "constructor") counts as none, rather than turn
// points into NaN or text.
export const knownTiming = (charge: Pick<Charge, "timing">): ChargeTiming | undefined => (typeof charge.timing === "string" && Object.hasOwn(TIMING_BONUS, charge.timing) ? charge.timing : undefined);

// A "green" charge is one in one of the day's best windows for the region
// (lib/timing.ts); charges from before timing keep the old absolute rule.
export function isGreenCharge(charge: Charge): boolean {
  const timing = knownTiming(charge);
  return timing ? timing === "best" : legacyGreen(charge);
}

// 10 for logging, plus the timing bonus (+10 best window, +5 cleaner hour).
// Nothing under MIN_POINTS_KWH.
export function pointsForCharge(charge: Charge): number {
  if (!earnsPoints(charge)) return 0;
  const timing = knownTiming(charge);
  return POINTS_PER_CHARGE + (timing ? TIMING_BONUS[timing] : legacyGreen(charge) ? GREEN_CHARGE_BONUS : 0);
}

export function totalPoints(charges: Charge[]): number {
  return charges.reduce((sum, charge) => sum + pointsForCharge(charge), 0);
}

// IST days and months as plain numbers (days since 1970, months since year 0),
// the same days and months as istDayKey and istMonthKey; NaN for a bad date.
const istDayNumber = (timestamp: number) => Math.floor((timestamp + IST_OFFSET_MS) / DAY_MS);
const istMonthNumber = (timestamp: number) => { const ist = new Date(timestamp + IST_OFFSET_MS); return ist.getUTCFullYear() * 12 + ist.getUTCMonth(); };

// Consecutive IST days (by loggedAt) with at least one charge, walking
// back from today. Today is allowed to be empty without breaking the streak
// (grace day) so it doesn't reset to 0 first thing each morning.
export function currentStreakDays(charges: Charge[], now = Date.now()): number {
  if (charges.length === 0) return 0;
  const loggedDays = new Set(charges.map((charge) => istDayNumber(Date.parse(charge.loggedAt))));
  let day = istDayNumber(now);
  if (!loggedDays.has(day)) day -= 1;
  let streak = 0;
  while (loggedDays.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

// The longest run of consecutive IST days with at least one charge anywhere in
// the history (same rule as currentStreakDays, without the walk back from
// today). Streak badges unlock from it, so they stay earned after a break.
export function longestStreakDays(charges: Charge[]): number {
  const days = [...new Set(charges.map((charge) => istDayNumber(Date.parse(charge.loggedAt))).filter(Number.isFinite))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  days.forEach((day, index) => {
    run = index > 0 && day === days[index - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return longest;
}

// Charges in the IST month containing `now` (like the recap and the
// leaderboard), offset by `monthsBack` (1 = the month before).
export function chargesInMonth(charges: Charge[], monthsBack = 0, now = Date.now()): Charge[] {
  const target = istMonthNumber(now) - monthsBack;
  return charges.filter((charge) => istMonthNumber(Date.parse(charge.loggedAt)) === target);
}

// Totals for a set of charges. `greenRate` is the share (0–1) charged while
// the grid was green, or null with no charges to measure.
export function impactSummary(charges: Charge[]) {
  return {
    kwh: charges.reduce((sum, charge) => sum + charge.energyKwh, 0),
    co2Kg: estimatedCarbonSavedGrams(charges) / 1000,
    count: charges.length,
    greenRate: charges.length ? charges.filter(isGreenCharge).length / charges.length : null,
  };
}

// A conservative "if you'd charged without timing it" reference point — the
// same real-grid range (650-800 gCO2/kWh) cited above for GREEN_CHARGE_FALLBACK_THRESHOLD,
// taken at its low end so this only ever *under*-claims savings.
export const UNTIMED_CHARGE_BASELINE = 650; // gCO2/kWh

// What an untimed charge would have averaged: the mean of the region's
// day by IST hour (the same average lib/timing.ts judges "cleaner" against),
// or null with no data. Some regions' grids run above 650 all day, where the
// fixed baseline would show nothing avoided however well a charge was timed.
export function baselineFromPattern(pattern: (number | null)[] | null): number | null {
  const known = pattern?.filter((value): value is number => value !== null && Number.isFinite(value)) ?? [];
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
}

// Grams of CO2 avoided vs. the untimed baseline, for charges that captured a
// carbonIntensity at log time. Charges without one (older entries, or a
// provider outage) are skipped rather than guessed at.
// The baseline is the region's average that day (`baselineIntensity`, saved
// at log time); older charges without it use UNTIMED_CHARGE_BASELINE.
export function estimatedCarbonSavedGrams(charges: Charge[]): number {
  return charges.reduce((sum, charge) => {
    if (charge.carbonIntensity === null) return sum;
    return sum + Math.max(0, (charge.baselineIntensity ?? UNTIMED_CHARGE_BASELINE) - charge.carbonIntensity) * charge.energyKwh;
  }, 0);
}

export const REWARD_TIERS = [
  { name: "Getting Started", threshold: 0 },
  { name: "Green Explorer", threshold: 200 },
  { name: "Carbon Saver", threshold: 600 },
  { name: "Grid Guardian", threshold: 1500 },
] as const;

// The evening peak (6-10 pm), when India's grid leans hardest on coal.
const PEAK_HOURS = { from: 18, to: 22 };
// By the IST hour it started (`chargedAt` is the phone's own clock, which may
// not be on IST); old charges with no real date go by `chargedAt`.
const isPeakCharge = (charge: Charge) => {
  const at = Date.parse(charge.loggedAt);
  const hour = at > 0 ? istHourOfDay(at) : Number(charge.chargedAt.split(":")[0]);
  return hour >= PEAK_HOURS.from && hour < PEAK_HOURS.to;
};

export type Achievement = { key: string; title: string; description: string; current: number; target: number; unit: string; unlocked: boolean };

// Every badge with its progress; `current` is capped at `target`. `streak` is
// the current streak: a locked streak badge shows progress from it, but it
// unlocks from the best streak ever, so a broken streak doesn't re-lock it.
export function achievements(all: Charge[], streak: number): Achievement[] {
  // Charges under MIN_POINTS_KWH count toward no badge; the streak badges go
  // by the streak, which they do count toward.
  const charges = all.filter(earnsPoints);
  const green = charges.filter(isGreenCharge).length;
  const savedKg = estimatedCarbonSavedGrams(charges) / 1000;
  const kwh = charges.reduce((sum, charge) => sum + charge.energyKwh, 0);
  const offPeak = charges.filter((charge) => !isPeakCharge(charge)).length;
  const bestStreak = Math.max(streak, longestStreakDays(all));
  const rows: (Omit<Achievement, "unlocked"> & { best?: number })[] = [
    { key: "first-green", title: "First Green Charge", description: "Charge in one of the day's best windows", current: green, target: 1, unit: "" },
    { key: "green-10", title: "Green Regular", description: "10 charges in best windows", current: green, target: 10, unit: "" },
    { key: "streak-7", title: "7-Day Streak", description: "Charge 7 days in a row", current: streak, best: bestStreak, target: 7, unit: " days" },
    { key: "streak-30", title: "30-Day Streak", description: "Charge 30 days in a row", current: streak, best: bestStreak, target: 30, unit: " days" },
    { key: "peak-dodger", title: "Peak Dodger", description: "5 charges outside the 6–10 pm peak", current: offPeak, target: 5, unit: "" },
    { key: "co2-10", title: "Carbon Cutter", description: "Avoid 10 kg of CO₂", current: savedKg, target: 10, unit: " kg" },
    { key: "co2-50", title: "Climate Champion", description: "Avoid 50 kg of CO₂", current: savedKg, target: 50, unit: " kg" },
    { key: "kwh-100", title: "100 kWh Club", description: "Charge 100 kWh in total", current: kwh, target: 100, unit: " kWh" },
  ];
  return rows.map(({ best, ...row }) => {
    const unlocked = (best ?? row.current) >= row.target;
    return { ...row, current: unlocked ? row.target : Math.min(row.current, row.target), unlocked };
  });
}

// How each badge's remaining amount reads in a sentence ("2 more green
// charges"); `count` badges are close within 2 steps, the rest at 80%.
const BADGE_STEPS: Record<string, { kind: "count" | "amount"; one?: string; many?: string; unit?: string }> = {
  "first-green": { kind: "count", one: "green charge", many: "green charges" },
  "green-10": { kind: "count", one: "green charge", many: "green charges" },
  "streak-7": { kind: "count", one: "day in a row", many: "days in a row" },
  "streak-30": { kind: "count", one: "day in a row", many: "days in a row" },
  "peak-dodger": { kind: "count", one: "charge outside the 6–10 pm peak", many: "charges outside the 6–10 pm peak" },
  "co2-10": { kind: "amount", unit: "kg more CO₂ avoided" },
  "co2-50": { kind: "amount", unit: "kg more CO₂ avoided" },
  "kwh-100": { kind: "amount", unit: "kWh more" },
};

// The locked badge nearest to done, when it's close enough to nudge about,
// with a ready-to-send sentence. Ties go to the earlier badge.
export function closestBadge(badges: Achievement[]): { key: string; hint: string } | null {
  let best: { badge: Achievement; fraction: number } | null = null;
  for (const badge of badges) {
    const steps = BADGE_STEPS[badge.key];
    if (badge.unlocked || !steps) continue;
    const remaining = badge.target - badge.current;
    const fraction = badge.current / badge.target;
    const close = steps.kind === "count" ? Math.ceil(remaining) <= 2 : fraction >= 0.8;
    if (close && (!best || fraction > best.fraction)) best = { badge, fraction };
  }
  if (!best) return null;
  const { badge } = best;
  const steps = BADGE_STEPS[badge.key];
  const remaining = badge.target - badge.current;
  if (steps.kind === "count") {
    const count = Math.ceil(remaining);
    return { key: badge.key, hint: `${count} more ${count === 1 ? steps.one : steps.many} to unlock ${badge.title}.` };
  }
  const amount = (Math.ceil(remaining * 10) / 10).toFixed(1).replace(/\.0$/, "");
  return { key: badge.key, hint: `${amount} ${steps.unit} to unlock ${badge.title}.` };
}


// This IST week so far (Monday 00:00 IST onwards), for the weekly recap.
export function weekSummary(charges: Charge[], now = Date.now()) {
  const istNow = new Date(now + IST_OFFSET_MS);
  const daysSinceMonday = (istNow.getUTCDay() + 6) % 7;
  const weekStart = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - daysSinceMonday * DAY_MS - IST_OFFSET_MS;
  const week = charges.filter((charge) => { const at = Date.parse(charge.loggedAt); return at >= weekStart && at <= now; });
  return {
    // The week's Monday (IST), so the server can tell a stale summary apart.
    weekStart: new Date(weekStart + IST_OFFSET_MS).toISOString().slice(0, 10),
    charges: week.length,
    co2Kg: Math.round(estimatedCarbonSavedGrams(week) / 100) / 10,
    greenPercent: week.length ? Math.round((week.filter(isGreenCharge).length / week.length) * 100) : 0,
  };
}

// 7 and 30 days are badges, announced as achievements instead.
const STREAK_MILESTONES = [3, 14, 60, 100];

// What logging `added` on top of `before` just earned — used for the
// confirmation toast and notifications. `rewards` lists only newly reached
// things (a level, an achievement, a streak milestone), most notable first.
export function chargeOutcome(before: Charge[], added: Charge, now = Date.now()) {
  const after = [added, ...before];
  const points = pointsForCharge(added);
  const green = isGreenCharge(added);
  const rewards: string[] = [];
  const tierBefore = currentRewardTier(totalPoints(before)).current;
  const tierAfter = currentRewardTier(totalPoints(after)).current;
  if (tierAfter.threshold > tierBefore.threshold) rewards.push(`New level: ${tierAfter.name}`);
  const streakBefore = currentStreakDays(before, now);
  const streakAfter = currentStreakDays(after, now);
  const unlockedBefore = new Set(achievements(before, streakBefore).filter((badge) => badge.unlocked).map((badge) => badge.key));
  for (const badge of achievements(after, streakAfter)) if (badge.unlocked && !unlockedBefore.has(badge.key)) rewards.push(`Achievement unlocked: ${badge.title}`);
  const milestone = [...STREAK_MILESTONES].reverse().find((days) => streakBefore < days && streakAfter >= days);
  if (milestone) rewards.push(`${milestone} days in a row`);
  return { points, green, rewards };
}

// The tier a points total currently sits in, and the next one up (null past the top tier).
export function currentRewardTier(points: number) {
  let current: (typeof REWARD_TIERS)[number] = REWARD_TIERS[0];
  let next: (typeof REWARD_TIERS)[number] | null = null;
  for (const tier of REWARD_TIERS) {
    if (points >= tier.threshold) current = tier;
    else { next = tier; break; }
  }
  return { current, next };
}
