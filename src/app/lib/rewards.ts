import type { Charge } from "../components/use-charges";

export const POINTS_PER_CHARGE = 10;
// Fallback only — used when a charge has no provider intensity_class (older
// charges, or a provider that doesn't classify tiers). India's real grid
// intensity commonly runs 650-800 gCO2/kWh with "yellow" starting around
// 476 (observed from the live India Energy Atlas zone data this app uses),
// so a fixed cutoff well below that approximates what "green" would mean.
export const GREEN_CHARGE_FALLBACK_THRESHOLD = 450; // gCO2/kWh
export const GREEN_CHARGE_BONUS = 5;
// Largest charge the log form accepts; the leaderboard clamps to it too.
// Comfortably above the largest EV battery sold in India (~100 kWh) — a
// typo like 1800 would otherwise inflate every total and become the next
// form's "typical" default.
export const MAX_CHARGE_KWH = 150;

export function isGreenCharge(charge: Charge): boolean {
  return charge.intensityClass
    ? charge.intensityClass === "green"
    : charge.carbonIntensity !== null && charge.carbonIntensity <= GREEN_CHARGE_FALLBACK_THRESHOLD;
}

export function pointsForCharge(charge: Charge): number {
  return POINTS_PER_CHARGE + (isGreenCharge(charge) ? GREEN_CHARGE_BONUS : 0);
}

export function totalPoints(charges: Charge[]): number {
  return charges.reduce((sum, charge) => sum + pointsForCharge(charge), 0);
}

// Consecutive calendar days (by loggedAt) with at least one charge, walking
// back from today. Today is allowed to be empty without breaking the streak
// (grace day) so it doesn't reset to 0 first thing each morning.
export function currentStreakDays(charges: Charge[]): number {
  if (charges.length === 0) return 0;
  const loggedDays = new Set(charges.map((charge) => new Date(charge.loggedAt).toDateString()));
  const cursor = new Date();
  if (!loggedDays.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (loggedDays.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Charges in the calendar month containing `date` (device-local, like the
// rest of the charge history), offset by `monthsBack` (1 = the month before).
export function chargesInMonth(charges: Charge[], monthsBack = 0, date = new Date()): Charge[] {
  const target = new Date(date.getFullYear(), date.getMonth() - monthsBack, 1);
  return charges.filter((charge) => {
    const loggedAt = new Date(charge.loggedAt);
    return loggedAt.getFullYear() === target.getFullYear() && loggedAt.getMonth() === target.getMonth();
  });
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

// Grams of CO2 avoided vs. the untimed baseline, for charges that captured a
// carbonIntensity at log time. Charges without one (older entries, or a
// provider outage) are skipped rather than guessed at.
export function estimatedCarbonSavedGrams(charges: Charge[]): number {
  return charges.reduce((sum, charge) => {
    if (charge.carbonIntensity === null) return sum;
    return sum + Math.max(0, UNTIMED_CHARGE_BASELINE - charge.carbonIntensity) * charge.energyKwh;
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
const isPeakCharge = (charge: Charge) => {
  const hour = Number(charge.chargedAt.slice(0, 2));
  return hour >= PEAK_HOURS.from && hour < PEAK_HOURS.to;
};

export type Achievement = { key: string; title: string; description: string; current: number; target: number; unit: string; unlocked: boolean };

// Every badge with its progress; `current` is capped at `target`.
export function achievements(charges: Charge[], streak: number): Achievement[] {
  const green = charges.filter(isGreenCharge).length;
  const savedKg = estimatedCarbonSavedGrams(charges) / 1000;
  const kwh = charges.reduce((sum, charge) => sum + charge.energyKwh, 0);
  const offPeak = charges.filter((charge) => !isPeakCharge(charge)).length;
  const rows: Omit<Achievement, "unlocked">[] = [
    { key: "first-green", title: "First Green Charge", description: "Charge while the grid is green", current: green, target: 1, unit: "" },
    { key: "green-10", title: "Green Regular", description: "10 charges in green hours", current: green, target: 10, unit: "" },
    { key: "streak-7", title: "7 Day Streak", description: "Charge 7 days in a row", current: streak, target: 7, unit: " days" },
    { key: "streak-30", title: "30 Day Streak", description: "Charge 30 days in a row", current: streak, target: 30, unit: " days" },
    { key: "peak-dodger", title: "Peak Dodger", description: "5 charges outside the 6-10 pm peak", current: offPeak, target: 5, unit: "" },
    { key: "co2-10", title: "Carbon Cutter", description: "Avoid 10 kg of CO₂", current: savedKg, target: 10, unit: " kg" },
    { key: "co2-50", title: "Climate Champion", description: "Avoid 50 kg of CO₂", current: savedKg, target: 50, unit: " kg" },
    { key: "kwh-100", title: "100 kWh Club", description: "Charge 100 kWh in total", current: kwh, target: 100, unit: " kWh" },
  ];
  return rows.map((row) => ({ ...row, current: Math.min(row.current, row.target), unlocked: row.current >= row.target }));
}

// 7 and 30 days are badges, announced as achievements instead.
const STREAK_MILESTONES = [3, 14, 60, 100];

// What logging `added` on top of `before` just earned — used for the
// confirmation toast and notifications. `rewards` lists only newly reached
// things (a level, an achievement, a streak milestone), most notable first.
export function chargeOutcome(before: Charge[], added: Charge) {
  const after = [added, ...before];
  const points = pointsForCharge(added);
  const green = isGreenCharge(added);
  const rewards: string[] = [];
  const tierBefore = currentRewardTier(totalPoints(before)).current;
  const tierAfter = currentRewardTier(totalPoints(after)).current;
  if (tierAfter.threshold > tierBefore.threshold) rewards.push(`New level: ${tierAfter.name}`);
  const streakBefore = currentStreakDays(before);
  const streakAfter = currentStreakDays(after);
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
