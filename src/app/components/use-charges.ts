"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";

// `loggedAt` is when the charge happened (the date + time entered in the log
// form) — streaks and monthly totals count by it, so a charge backfilled for
// yesterday lands on yesterday. Charges saved before the date field existed
// hold the time they were logged instead, which was the same day in practice.
// `intensitySource` says where `carbonIntensity` came from: the live reading
// ("live") or the typical value for that hour of day ("typical").
export type Charge = { id: string; energyKwh: number; chargedAt: string; city: string; carbonIntensity: number | null; intensityClass?: string | null; intensitySource?: "live" | "typical"; loggedAt: string };
const STORAGE_KEY = "zeroemit-charges";
const EMPTY: Charge[] = [];

// Charges saved before `loggedAt` existed don't have it. Backfill a sentinel
// far-past date so streak/monthly-total date math treats them as "not
// recent" instead of rendering "Invalid Date" or producing NaN.
export const LEGACY_LOGGED_AT = new Date(0).toISOString();
function normalizeCharge(raw: Charge): Charge {
  return typeof raw.loggedAt === "string" && !Number.isNaN(Date.parse(raw.loggedAt)) ? raw : { ...raw, loggedAt: LEGACY_LOGGED_AT };
}

// A hand-edited or corrupted entry with a non-numeric energy would turn every
// kWh sum into string concatenation or NaN — drop it rather than poison totals.
function isValidCharge(raw: unknown): raw is Charge {
  return Boolean(raw && typeof raw === "object" && Number.isFinite((raw as Charge).energyKwh) && (raw as Charge).energyKwh > 0);
}

const newestFirst = (a: Charge, b: Charge) => b.loggedAt.localeCompare(a.loggedAt);

const store = createLocalStorageStore<Charge[]>(
  STORAGE_KEY,
  (raw) => { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter(isValidCharge).map(normalizeCharge).sort(newestFirst) : EMPTY; },
  (value) => JSON.stringify(value),
  EMPTY,
);

export function useCharges() {
  const charges = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const addCharge = useCallback((charge: Omit<Charge, "id">) => {
    store.write([{ ...charge, id: crypto.randomUUID() }, ...store.getSnapshot()].sort(newestFirst));
  }, []);
  const removeCharge = useCallback((id: string) => store.write(store.getSnapshot().filter((charge) => charge.id !== id)), []);
  const clearCharges = useCallback(() => store.write(EMPTY), []);
  return { charges, addCharge, removeCharge, clearCharges };
}
