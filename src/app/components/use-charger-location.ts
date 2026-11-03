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
  | { status: "denied"; again?: boolean } // `again`: still blocked when asked once more
  | { status: "outside" } // a position outside India, which the server can't search
  | { status: "unavailable" };

const PREF_KEY = "zeroemit-chargers-near-me";
// The browser's own timeout only starts once the permission prompt is
// answered, so a prompt that's ignored would leave "Finding your location…"
// up for good; after this long the city centre is used instead.
const GIVE_UP_MS = 15_000;
const listeners = new Set<() => void>();
let state: ChargerLocation = { status: "off" };
// Bumped by each request and by switching back to the city centre, so an
// answer that arrives after that is ignored.
let request = 0;

function set(next: ChargerLocation) { state = next; listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const OFF: ChargerLocation = { status: "off" };

function readPref() { try { return window.localStorage.getItem(PREF_KEY) === "1"; } catch { return false; } }
function writePref(on: boolean) { try { if (on) window.localStorage.setItem(PREF_KEY, "1"); else window.localStorage.removeItem(PREF_KEY); } catch { /* storage unavailable */ } }

// "Delete my data": stop using (and asking for) the device's position.
export function forgetChargerLocation() { switchToCityCentre(); }

// Back to the city centre; an answer still on its way is ignored.
function switchToCityCentre() { request += 1; writePref(false); set(OFF); }

function locate() {
  if (!("geolocation" in navigator)) { set({ status: "unavailable" }); return; }
  const id = ++request;
  const wasDenied = state.status === "denied";
  set({ status: "locating" });
  // Still waiting (an unanswered prompt): fall back to the city centre. A
  // late answer still counts, as nothing else has been chosen since.
  setTimeout(() => { if (id === request && state.status === "locating") set({ status: "unavailable" }); }, GIVE_UP_MS);
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (id !== request) return;
      const { latitude, longitude } = position.coords;
      set(isInIndia(latitude, longitude) ? { status: "on", lat: roundCoordinate(latitude), lon: roundCoordinate(longitude) } : { status: "outside" });
    },
    (error) => {
      if (id !== request) return;
      // Blocked: stop asking until they tap the button again.
      if (error.code === error.PERMISSION_DENIED) { writePref(false); set({ status: "denied", again: wasDenied }); } else set({ status: "unavailable" });
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
    chooseCityCentre: switchToCityCentre,
  };
}
