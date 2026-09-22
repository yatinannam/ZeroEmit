"use client";
import { useState } from "react";
import { useStoredLocation } from "./use-location";
import type { City } from "../lib/grid";

// The pin-icon-opens-a-city-modal pattern is identical on every tab (open
// state + the city setter + the "pick one, close the modal" handler) — one
// hook instead of re-deriving it per screen.
export function useLocationPicker() {
  const [location, setLocation] = useStoredLocation();
  const [locationOpen, setLocationOpen] = useState(false);
  return {
    location,
    setLocation,
    locationOpen,
    openLocation: () => setLocationOpen(true),
    closeLocation: () => setLocationOpen(false),
    chooseLocation: (next: City) => { setLocation(next); setLocationOpen(false); },
  };
}
