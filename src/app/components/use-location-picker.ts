"use client";
import { useState } from "react";
import { useStoredLocation } from "./use-location";
import { showToast } from "./toast";
import { DEFAULT_PLACE, placeLabel, ZONE_LABELS, zoneOf, type Place } from "../lib/places";

// The pin-icon-opens-a-location-sheet pattern is identical on every tab
// (open state + the place setter + "pick one, close the sheet"). `location`
// is the display label ("Pune, Maharashtra"), which charges also store.
// Until a place is chosen (first launch) screens fall back to DEFAULT_PLACE;
// the first-run setup sheet (LocationGate) asks before that matters.
export function useLocationPicker() {
  const [stored, setPlace] = useStoredLocation();
  const [locationOpen, setLocationOpen] = useState(false);
  const place = stored ?? DEFAULT_PLACE;
  return {
    place,
    location: placeLabel(place),
    setPlace,
    locationOpen,
    openLocation: () => setLocationOpen(true),
    closeLocation: () => setLocationOpen(false),
    chooseLocation: (next: Place) => {
      setPlace(next);
      setLocationOpen(false);
      showToast(`Location set to ${placeLabel(next)} · ${ZONE_LABELS[zoneOf(next)]}`);
    },
  };
}
