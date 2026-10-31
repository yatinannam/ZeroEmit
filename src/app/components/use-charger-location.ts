"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useHydrated } from "./use-hydrated";
import { isInIndia } from "../lib/places";
import { roundCoordinate } from "../lib/stations";

// Where to look for chargers: the user's own position (only after they tap
// "Use my location"), rounded to ~1 km on the device before it's sent
// anywhere. Grid data and points keep using the chosen city; this is only
// for finding chargers. The choice is remembered; the position isn't stored.
export type ChargerLocation =
  | { status: "off" }
  | { status: "locating" }
  | { status: "on"; lat: number; lon: number }
  | { status: "denied" }
  | { status: "outside" } // a position outside India, which the server can't search
  | { status: "unavailable" };

const PREF_KEY = "zeroemit-chargers-near-me";
const listeners = new Set<() => void>();
let state: ChargerLocation = { status: "off" };

function set(next: ChargerLocation) { state = next; listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const OFF: ChargerLocation = { status: "off" };

function readPref() { try { return window.localStorage.getItem(PREF_KEY) === "1"; } catch { return false; } }
function writePref(on: boolean) { try { if (on) window.localStorage.setItem(PREF_KEY, "1"); else window.localStorage.removeItem(PREF_KEY); } catch { /* storage unavailable */ } }

// "Delete my data": stop using (and asking for) the device's position.
export function forgetChargerLocation() { writePref(false); set(OFF); }

function locate() {
  if (!("geolocation" in navigator)) { set({ status: "unavailable" }); return; }
  set({ status: "locating" });
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      set(isInIndia(latitude, longitude) ? { status: "on", lat: roundCoordinate(latitude), lon: roundCoordinate(longitude) } : { status: "outside" });
    },
    (error) => {
      // Blocked: stop asking until they tap the button again.
      if (error.code === error.PERMISSION_DENIED) { writePref(false); set({ status: "denied" }); } else set({ status: "unavailable" });
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
  );
}

const LOCATING: ChargerLocation = { status: "locating" };

export function useChargerLocation() {
  const location = useSyncExternalStore(subscribe, () => state, () => OFF);
  const hydrated = useHydrated();
  // Someone who chose "Use my location" before gets it again on the next visit.
  useEffect(() => { if (state.status === "off" && readPref()) locate(); }, []);
  // Until that starts, they already count as locating, so the city centre
  // isn't searched first and then replaced.
  const resuming = hydrated && location.status === "off" && readPref();
  return {
    location: resuming ? LOCATING : location,
    chooseMyLocation: () => { writePref(true); locate(); },
    chooseCityCentre: () => { writePref(false); set({ status: "off" }); },
  };
}
