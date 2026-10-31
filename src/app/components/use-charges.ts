"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useHydrated } from "./use-hydrated";
import { createLocalStorageStore } from "./local-storage-store";
import { LEGACY_LABELS, placeLabel } from "../lib/places";
import type { ChargeTiming } from "../lib/timing";

// `loggedAt` is when the charge happened (the date + time entered in the log
// form) — streaks and monthly totals count by it, so a charge backfilled for
// yesterday lands on yesterday. Charges saved before the date field existed
// hold the time they were logged instead, which was the same day in practice.
// `intensitySource` says where `carbonIntensity` came from: the live reading
// ("live") or the typical value for that hour of day ("typical").
// `timing`: how the charge was timed against the region's typical day when it
// was logged (lib/timing.ts) — absent on charges from before it was recorded.
export type Charge = { id: string; energyKwh: number; chargedAt: string; city: string; carbonIntensity: number | null; intensityClass?: string | null; intensitySource?: "live" | "typical"; timing?: ChargeTiming; loggedAt: string };
const STORAGE_KEY = "zeroemit-charges";
const EMPTY: Charge[] = [];

// Charges saved before `loggedAt` existed don't have it. Backfill a sentinel
// far-past date so streak/monthly-total date math treats them as "not
// recent" instead of rendering "Invalid Date" or producing NaN.
export const LEGACY_LOGGED_AT = new Date(0).toISOString();
// Charges from before location search stored "Chennai, India"-style labels;
// relabel them so they still match the current place ("Chennai, Tamil Nadu").
function normalizeCharge(raw: Charge): Charge {
  const legacyPlace = LEGACY_LABELS[raw.city];
  const charge = legacyPlace ? { ...raw, city: placeLabel(legacyPlace) } : raw;
  const dated = typeof charge.loggedAt === "string" && !Number.isNaN(Date.parse(charge.loggedAt)) ? charge : { ...charge, loggedAt: LEGACY_LOGGED_AT };
  // The time of day ("HH:MM") and intensity feed every screen's formatting;
  // a damaged one is rebuilt or dropped rather than crash the app.
  const timed = typeof dated.chargedAt === "string" && /^\d{1,2}:\d{2}$/.test(dated.chargedAt) ? dated : { ...dated, chargedAt: timeOfDay(new Date(dated.loggedAt)) };
  return Number.isFinite(timed.carbonIntensity) || timed.carbonIntensity === null ? timed : { ...timed, carbonIntensity: null };
}

const timeOfDay = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

// A hand-edited or corrupted entry with a non-numeric energy would turn every
// kWh sum into string concatenation or NaN — drop it rather than poison totals.
function isValidCharge(raw: unknown): raw is Charge {
  return Boolean(raw && typeof raw === "object" && Number.isFinite((raw as Charge).energyKwh) && (raw as Charge).energyKwh > 0 && typeof (raw as Charge).city === "string");
}

const newestFirst = (a: Charge, b: Charge) => b.loggedAt.localeCompare(a.loggedAt);

const store = createLocalStorageStore<Charge[]>(
  STORAGE_KEY,
  (raw) => { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter(isValidCharge).map(normalizeCharge).sort(newestFirst) : EMPTY; },
  (value) => JSON.stringify(value),
  EMPTY,
);

// `ready` is false until the saved charges have been read: the prerendered
// page has none, so "no charges yet" before then would be a guess.
export function useCharges() {
  const charges = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const ready = useHydrated();
  const addCharge = useCallback((charge: Omit<Charge, "id">) => {
    store.write([{ ...charge, id: crypto.randomUUID() }, ...store.getSnapshot()].sort(newestFirst));
  }, []);
  const removeCharge = useCallback((id: string) => store.write(store.getSnapshot().filter((charge) => charge.id !== id)), []);
  // Puts a just-deleted charge back as it was (Undo).
  const restoreCharge = useCallback((charge: Charge) => {
    const rest = store.getSnapshot().filter((other) => other.id !== charge.id);
    store.write([charge, ...rest].sort(newestFirst));
  }, []);
  const clearCharges = useCallback(() => store.write(EMPTY), []);
  return { charges, ready, addCharge, removeCharge, restoreCharge, clearCharges };
}
