"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import { parsePricePerKwh } from "../lib/cost";
import { OTHER_VEHICLE, parseBatteryKwh, vehicleByKey } from "../lib/vehicles";

// `joinedAt` is when this device first finished setup (for "member since").
// `pricePerKwh`: the driver's electricity price, for cost estimates.
// `vehicleKey`: a preset from lib/vehicles.ts (or "other"), and
// `batteryKwh` its usable battery, so charges can be logged by battery %.
export type Profile = { name: string; vehicle: string; joinedAt?: string; pricePerKwh?: number; vehicleKey?: string; batteryKwh?: number };
const STORAGE_KEY = "zeroemit-profile";
const DEFAULT_PROFILE: Profile = { name: "", vehicle: "" };

function normalizeProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== "object") return DEFAULT_PROFILE;
  const value = raw as Record<string, unknown>;
  const joinedAt = typeof value.joinedAt === "string" && !Number.isNaN(Date.parse(value.joinedAt)) ? value.joinedAt : undefined;
  const pricePerKwh = parsePricePerKwh(value.pricePerKwh);
  const vehicleKey = typeof value.vehicleKey === "string" && (value.vehicleKey === OTHER_VEHICLE || vehicleByKey(value.vehicleKey)) ? value.vehicleKey : undefined;
  // A preset knows its own battery, even if an older save didn't keep it.
  const batteryKwh = parseBatteryKwh(value.batteryKwh) ?? vehicleByKey(vehicleKey)?.batteryKwh ?? null;
  return { name: typeof value.name === "string" ? value.name : "", vehicle: typeof value.vehicle === "string" ? value.vehicle : "", ...(joinedAt ? { joinedAt } : {}), ...(pricePerKwh ? { pricePerKwh } : {}), ...(vehicleKey ? { vehicleKey } : {}), ...(batteryKwh ? { batteryKwh } : {}) };
}

const store = createLocalStorageStore<Profile>(
  STORAGE_KEY,
  (raw) => normalizeProfile(JSON.parse(raw)),
  (value) => JSON.stringify(value),
  DEFAULT_PROFILE,
);

export function useProfile() {
  const profile = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const updateProfile = useCallback((next: Profile) => store.write(next), []);
  const resetProfile = useCallback(() => store.write(DEFAULT_PROFILE), []);
  return { profile, updateProfile, resetProfile };
}
