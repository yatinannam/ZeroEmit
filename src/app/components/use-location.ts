"use client";
import { useCallback, useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import { DEFAULT_CITY, type City } from "../lib/grid";

const STORAGE_KEY = "zeroemit-location";

function parseCity(raw: string): City {
  return raw === "Bengaluru, India" || raw === "Mumbai, India" ? raw : DEFAULT_CITY;
}

// Stored as a plain string (not JSON) — parse/serialize are identity-ish
// validation, matching the existing on-disk format for current users.
const store = createLocalStorageStore<City>(STORAGE_KEY, parseCity, (city) => city, DEFAULT_CITY);

export function useStoredLocation() {
  const location = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const setLocation = useCallback((next: City) => store.write(next), []);
  return [location, setLocation] as const;
}
