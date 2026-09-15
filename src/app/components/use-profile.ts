"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";

export type Profile = { name: string; vehicle: string };
const STORAGE_KEY = "zeroemit-profile";
const DEFAULT_PROFILE: Profile = { name: "", vehicle: "" };

function normalizeProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== "object") return DEFAULT_PROFILE;
  const value = raw as Record<string, unknown>;
  return { name: typeof value.name === "string" ? value.name : "", vehicle: typeof value.vehicle === "string" ? value.vehicle : "" };
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
  return { profile, updateProfile };
}
