"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import { CHARGERS, DEFAULT_CHARGER, MAX_PLAN_KWH, MIN_PLAN_KWH, type ChargerKey } from "../lib/planner";

// What the charge planner was last asked, so it opens with the same charger
// and deadline. `kwh` is null until the driver types one: the planner then
// suggests their usual charge. `byPercent` (with `from`/`to`): the energy is
// asked as a battery % gain instead, once Profile knows the EV's battery.
export type PlannerSettings = { kwh: number | null; charger: ChargerKey; readyBy: string; byPercent: boolean; from: number; to: number };
const DEFAULT_SETTINGS: PlannerSettings = { kwh: null, charger: DEFAULT_CHARGER, readyBy: "07:00", byPercent: true, from: 20, to: 80 };
const isPercent = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;

export const isPlanKwh = (value: number) => Number.isFinite(value) && value >= MIN_PLAN_KWH && value <= MAX_PLAN_KWH;

function normalize(raw: unknown): PlannerSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const value = raw as Record<string, unknown>;
  const kwh = typeof value.kwh === "number" && isPlanKwh(value.kwh) ? value.kwh : null;
  const charger = CHARGERS.some((option) => option.key === value.charger) ? value.charger as ChargerKey : DEFAULT_CHARGER;
  const readyBy = typeof value.readyBy === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.readyBy) ? value.readyBy : DEFAULT_SETTINGS.readyBy;
  const [from, to] = isPercent(value.from) && isPercent(value.to) && value.to > value.from ? [value.from, value.to] : [DEFAULT_SETTINGS.from, DEFAULT_SETTINGS.to];
  return { kwh, charger, readyBy, byPercent: typeof value.byPercent === "boolean" ? value.byPercent : DEFAULT_SETTINGS.byPercent, from, to };
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
