"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import { CHARGERS, DEFAULT_CHARGER, MAX_PLAN_KWH, MIN_PLAN_KWH, type ChargerKey } from "../lib/planner";

// What the charge planner was last asked, so it opens with the same charger
// and deadline. `kwh` is null until the driver types one: the planner then
// suggests their usual charge.
export type PlannerSettings = { kwh: number | null; charger: ChargerKey; readyBy: string };
const DEFAULT_SETTINGS: PlannerSettings = { kwh: null, charger: DEFAULT_CHARGER, readyBy: "07:00" };

export const isPlanKwh = (value: number) => Number.isFinite(value) && value >= MIN_PLAN_KWH && value <= MAX_PLAN_KWH;

function normalize(raw: unknown): PlannerSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const value = raw as Record<string, unknown>;
  const kwh = typeof value.kwh === "number" && isPlanKwh(value.kwh) ? value.kwh : null;
  const charger = CHARGERS.some((option) => option.key === value.charger) ? value.charger as ChargerKey : DEFAULT_CHARGER;
  const readyBy = typeof value.readyBy === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.readyBy) ? value.readyBy : DEFAULT_SETTINGS.readyBy;
  return { kwh, charger, readyBy };
}

const store = createLocalStorageStore<PlannerSettings>(
  "zeroemit-planner",
  (raw) => normalize(JSON.parse(raw)),
  (value) => JSON.stringify(value),
  DEFAULT_SETTINGS,
);

export function usePlannerSettings() {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const update = useCallback((change: Partial<PlannerSettings>) => store.write({ ...store.getSnapshot(), ...change }), []);
  return { settings, update };
}

// Forgotten with the rest of the device's data (Profile → Delete my data).
export function resetPlannerSettings() {
  store.write(DEFAULT_SETTINGS);
}
