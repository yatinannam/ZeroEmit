// Charging cost estimates from the driver's own electricity price. Without
// one, a typical Indian home tariff; public fast chargers cost a lot more,
// which is why the price can be set in Profile & vehicle.
export const DEFAULT_PRICE_PER_KWH = 8;
const MIN_PRICE = 1;
const MAX_PRICE = 60;

export function chargeCost(kwh: number, pricePerKwh = DEFAULT_PRICE_PER_KWH) {
  return Math.round(kwh * pricePerKwh);
}

export function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// A price typed into the form (or stored), or null when it isn't a sensible
// per-kWh price.
export function parsePricePerKwh(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < MIN_PRICE || value > MAX_PRICE) return null;
  return Math.round(value * 100) / 100;
}

// What's wrong with a price typed into Profile & vehicle, said so the driver
// can fix it, or null when it can be saved. Blank is fine: the typical tariff.
export function priceError(raw: string): string | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return "Enter the price as a number, like 7.5.";
  if (value < MIN_PRICE) return `Enter at least ₹${MIN_PRICE} per kWh, or leave it blank to use ₹${DEFAULT_PRICE_PER_KWH}.`;
  if (value > MAX_PRICE) return `Enter ₹${MAX_PRICE} per kWh or less, or leave it blank to use ₹${DEFAULT_PRICE_PER_KWH}.`;
  return null;
}
