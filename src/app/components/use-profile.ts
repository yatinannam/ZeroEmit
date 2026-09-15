"use client";
import { useCallback, useSyncExternalStore } from "react";

export type Profile = { name: string; vehicle: string };
const STORAGE_KEY = "zeroemit-profile";
const DEFAULT_PROFILE: Profile = { name: "", vehicle: "" };

const listeners = new Set<() => void>();
function notify() { listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

// Cache against the raw string so getSnapshot returns a stable reference
// when nothing changed (required by useSyncExternalStore).
let cachedRaw: string | null = null;
let cachedProfile: Profile = DEFAULT_PROFILE;
function getSnapshot(): Profile {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedProfile;
  cachedRaw = raw;
  try {
    const value = JSON.parse(raw || "null");
    cachedProfile = value && typeof value === "object"
      ? { name: typeof value.name === "string" ? value.name : "", vehicle: typeof value.vehicle === "string" ? value.vehicle : "" }
      : DEFAULT_PROFILE;
  } catch { cachedProfile = DEFAULT_PROFILE; }
  return cachedProfile;
}
function getServerSnapshot(): Profile { return DEFAULT_PROFILE; }

export function useProfile() {
  const profile = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const updateProfile = useCallback((next: Profile) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notify();
  }, []);
  return { profile, updateProfile };
}
