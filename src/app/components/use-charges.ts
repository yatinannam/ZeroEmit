"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";

export type Charge = { id: string; energyKwh: number; chargedAt: string; city: string; carbonIntensity: number | null; intensityClass?: string | null; loggedAt: string };
const STORAGE_KEY = "zeroemit-charges";
const EMPTY: Charge[] = [];

// Charges saved before `loggedAt` existed don't have it. Backfill a sentinel
// far-past date so streak/monthly-total date math treats them as "not
// recent" instead of rendering "Invalid Date" or producing NaN.
export const LEGACY_LOGGED_AT = new Date(0).toISOString();
function normalizeCharge(raw: Charge): Charge {
  return typeof raw.loggedAt === "string" && !Number.isNaN(Date.parse(raw.loggedAt)) ? raw : { ...raw, loggedAt: LEGACY_LOGGED_AT };
}

const store = createLocalStorageStore<Charge[]>(
  STORAGE_KEY,
  (raw) => { const value = JSON.parse(raw); return Array.isArray(value) ? value.map(normalizeCharge) : EMPTY; },
  (value) => JSON.stringify(value),
  EMPTY,
);

export function useCharges() {
  const charges = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const addCharge = useCallback((charge: Omit<Charge, "id" | "loggedAt">) => {
    store.write([{ ...charge, id: crypto.randomUUID(), loggedAt: new Date().toISOString() }, ...store.getSnapshot()]);
  }, []);
  const clearCharges = useCallback(() => store.write(EMPTY), []);
  return { charges, addCharge, clearCharges };
}
