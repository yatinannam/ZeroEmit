import type { Charge } from "../components/use-charges";

export const POINTS_PER_CHARGE = 10;
// Fallback only — used when a charge has no provider intensity_class (older
// charges, or a provider that doesn't classify tiers). India's real grid
// intensity commonly runs 650-800 gCO2/kWh with "yellow" starting around
// 476 (observed from the live India Energy Atlas zone data this app uses),
// so a fixed cutoff well below that approximates what "green" would mean.
export const GREEN_CHARGE_FALLBACK_THRESHOLD = 450; // gCO2/kWh
export const GREEN_CHARGE_BONUS = 5;
export const POINTS_PER_REWARD = 200;

export function pointsForCharge(charge: Charge): number {
  const isGreen = charge.intensityClass
    ? charge.intensityClass === "green"
    : charge.carbonIntensity !== null && charge.carbonIntensity <= GREEN_CHARGE_FALLBACK_THRESHOLD;
  return POINTS_PER_CHARGE + (isGreen ? GREEN_CHARGE_BONUS : 0);
}

export function totalPoints(charges: Charge[]): number {
  return charges.reduce((sum, charge) => sum + pointsForCharge(charge), 0);
}

export function pointsToNextReward(points: number): number {
  const remainder = points % POINTS_PER_REWARD;
  return remainder === 0 ? POINTS_PER_REWARD : POINTS_PER_REWARD - remainder;
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
