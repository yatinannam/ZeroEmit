import type { Charge } from "../components/use-charges";

export function averageEnergyKwh(charges: Charge[]): number | null {
  if (!charges.length) return null;
  return charges.reduce((sum, charge) => sum + charge.energyKwh, 0) / charges.length;
}

// Average carbon intensity across charges that captured one at log time
// (older/legacy charges may have carbonIntensity: null and are skipped).
export function averageChargeIntensity(charges: Charge[]): number | null {
  const known = charges.map((charge) => charge.carbonIntensity).filter((value): value is number => value !== null);
  if (!known.length) return null;
  return known.reduce((sum, value) => sum + value, 0) / known.length;
}

// The user's most common charge start time ("chargedAt", e.g. "23:30"),
// bucketed by hour so near-identical times count together. Returns one
// representative "HH:MM" sample from the winning hour, or null with no
// history. Ties break toward whichever hour was seen first.
export function typicalChargeTime(charges: Charge[]): string | null {
  const hourBuckets = new Map<number, { count: number; sample: string }>();
  for (const charge of charges) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(charge.chargedAt);
    if (!match) continue;
    const hour = Number(match[1]);
    const existing = hourBuckets.get(hour);
    if (existing) existing.count += 1; else hourBuckets.set(hour, { count: 1, sample: charge.chargedAt });
  }
  let best: { count: number; sample: string } | null = null;
  for (const bucket of hourBuckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  return best?.sample ?? null;
}

export function formatTimeOfDay(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  const date = new Date();
  date.setHours(Number(hourStr), Number(minuteStr), 0, 0);
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(date);
}
