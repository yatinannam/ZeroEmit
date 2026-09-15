"use client";
import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_CITY, type City } from "../lib/grid";

const LOCATION_KEY = "zeroemit-location";

const listeners = new Set<() => void>();
function notify() { listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

function getSnapshot(): City {
  const saved = window.localStorage.getItem(LOCATION_KEY);
  return saved === "Bengaluru, India" || saved === "Mumbai, India" ? saved : DEFAULT_CITY;
}
function getServerSnapshot(): City { return DEFAULT_CITY; }

export function useStoredLocation() {
  const location = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setLocation = useCallback((next: City) => {
    window.localStorage.setItem(LOCATION_KEY, next);
    notify();
  }, []);
  return [location, setLocation] as const;
}
