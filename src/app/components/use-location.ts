"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import { isPlace, LEGACY_LABELS, type Place } from "../lib/places";

const STORAGE_KEY = "zeroemit-location";

// `null` means the user hasn't picked a place yet (first launch). Older
// installs stored one of three plain "City, India" strings; map those over.
function parsePlace(raw: string): Place | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (isPlace(value)) return { name: value.name, state: value.state };
  } catch { /* not JSON — a legacy plain-string value */ }
  return LEGACY_LABELS[raw] ?? null;
}

const store = createLocalStorageStore<Place | null>(STORAGE_KEY, parsePlace, (place) => JSON.stringify(place), null);

export function useStoredLocation() {
  const place = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const setPlace = useCallback((next: Place | null) => store.write(next), []);
  return [place, setPlace] as const;
}
