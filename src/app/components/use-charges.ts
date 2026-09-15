"use client";
import { useCallback, useSyncExternalStore } from "react";

export type Charge = { id: string; energyKwh: number; chargedAt: string; city: string; carbonIntensity: number | null; loggedAt: string };
const STORAGE_KEY = "zeroemit-charges";
const EMPTY: Charge[] = [];

const listeners = new Set<() => void>();
function notify() { listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

// useSyncExternalStore requires getSnapshot to return a referentially stable
// value when nothing changed (otherwise it can loop). Cache the parsed array
// against the raw string and only re-parse when the raw value actually changes.
let cachedRaw: string | null = null;
let cachedCharges: Charge[] = EMPTY;
function getSnapshot(): Charge[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedCharges;
  cachedRaw = raw;
  try { const value = JSON.parse(raw || "[]"); cachedCharges = Array.isArray(value) ? value : EMPTY; } catch { cachedCharges = EMPTY; }
  return cachedCharges;
}
function getServerSnapshot(): Charge[] { return EMPTY; }

export function useCharges() {
  const charges = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const addCharge = useCallback((charge: Omit<Charge, "id" | "loggedAt">) => {
    const next = [{ ...charge, id: crypto.randomUUID(), loggedAt: new Date().toISOString() }, ...getSnapshot()];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notify();
  }, []);
  return { charges, addCharge };
}
