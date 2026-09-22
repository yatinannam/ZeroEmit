import type { Charge } from "../components/use-charges";

export const POINTS_PER_CHARGE = 10;
// Fallback only — used when a charge has no provider intensity_class (older
// charges, or a provider that doesn't classify tiers). India's real grid
// intensity commonly runs 650-800 gCO2/kWh with "yellow" starting around
// 476 (observed from the live India Energy Atlas zone data this app uses),
// so a fixed cutoff well below that approximates what "green" would mean.
export const GREEN_CHARGE_FALLBACK_THRESHOLD = 450; // gCO2/kWh
export const GREEN_CHARGE_BONUS = 5;

export function pointsForCharge(charge: Charge): number {
  const isGreen = charge.intensityClass
    ? charge.intensityClass === "green"
    : charge.carbonIntensity !== null && charge.carbonIntensity <= GREEN_CHARGE_FALLBACK_THRESHOLD;
  return POINTS_PER_CHARGE + (isGreen ? GREEN_CHARGE_BONUS : 0);
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

export function chargesInCurrentMonth(charges: Charge[]): Charge[] {
  const now = new Date();
  return charges.filter((charge) => {
    const loggedAt = new Date(charge.loggedAt);
    return loggedAt.getFullYear() === now.getFullYear() && loggedAt.getMonth() === now.getMonth();
  });
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
