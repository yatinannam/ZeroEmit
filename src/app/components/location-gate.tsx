"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useStoredLocation } from "./use-location";
import { useProfile } from "./use-profile";
import { LocationSearch } from "./location-search";
import { showToast } from "./toast";
import { DEFAULT_PLACE, placeLabel, ZONE_LABELS, zoneOf, type Place } from "../lib/places";

const noopSubscribe = () => () => {};

// First-launch "Where do you charge?" screen, shown over whichever page the
// user lands on until a place is chosen. Waits for hydration — the server
// can't see localStorage, so rendering it on the server would flash it at
// returning users too.
export function LocationGate() {
  const [stored, setPlace] = useStoredLocation();
  const { profile, updateProfile } = useProfile();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = hydrated && stored === null;

  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  if (!open) return null;

  function choose(place: Place) {
    setPlace(place);
    if (!profile.joinedAt) updateProfile({ ...profile, joinedAt: new Date().toISOString() });
    showToast(`Location set to ${placeLabel(place)} · ${ZONE_LABELS[zoneOf(place)]}`);
  }

  return <div className="setup-screen" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <div ref={panelRef} className="setup-panel" tabIndex={-1}>
      <p className="eyebrow">Welcome to ZeroEmit</p>
      <h1 id="setup-title">Where do you charge?</h1>
      <p className="secondary-intro">We use your state&apos;s regional grid to find the cleanest times to charge. Your exact location stays on this device.</p>
      <LocationSearch current={null} onChoose={choose}/>
      <button type="button" className="text-button" onClick={() => choose(DEFAULT_PLACE)}>Skip for now (use {DEFAULT_PLACE.name})</button>
    </div>
  </div>;
}
