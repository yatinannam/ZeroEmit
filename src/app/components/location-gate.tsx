"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useStoredLocation } from "./use-location";
import { useProfile } from "./use-profile";
import { createLocalStorageStore } from "./local-storage-store";
import { OnboardingIntro } from "./onboarding-intro";
import { LocationSearch } from "./location-search";
import { showToast } from "./toast";
import { DEFAULT_PLACE, placeLabel, ZONE_LABELS, zoneOf, type Place } from "../lib/places";

const noopSubscribe = () => () => {};

const introStore = createLocalStorageStore<boolean>("zeroemit-intro-seen", (raw) => raw === "1", (seen) => (seen ? "1" : "0"), false);

// Delete account starts over from the welcome intro.
export function resetIntroSeen() {
  introStore.write(false);
}

// First launch: the three-screen welcome intro, then "Where do you charge?",
// shown over whichever page the user lands on until a place is chosen.
// Existing users (who already have a place) never see either. Waits for
// hydration — the server can't see localStorage, so rendering it on the
// server would flash it at returning users too.
export function LocationGate() {
  const [stored, setPlace] = useStoredLocation();
  const { profile, updateProfile } = useProfile();
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const introSeen = useSyncExternalStore(introStore.subscribe, introStore.getSnapshot, introStore.getServerSnapshot);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = hydrated && stored === null;

  // Focus the step that's showing — and again when the intro hands over.
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open, introSeen]);

  // The page behind stays out of reach (Tab, taps, screen readers) until a
  // place is chosen, like any modal screen.
  useEffect(() => {
    if (!open) return;
    const behind = [...document.body.children].filter((element) => !element.classList.contains("setup-screen") && !element.classList.contains("toast-region"));
    behind.forEach((element) => element.setAttribute("inert", ""));
    return () => behind.forEach((element) => element.removeAttribute("inert"));
  }, [open]);

  if (!open) return null;

  function choose(place: Place) {
    setPlace(place);
    if (!profile.joinedAt) updateProfile({ ...profile, joinedAt: new Date().toISOString() });
    showToast(`Location set to ${placeLabel(place)} · ${ZONE_LABELS[zoneOf(place)]}`);
  }

  if (!introSeen) return <div className="setup-screen" role="dialog" aria-modal="true" aria-label="Welcome to ZeroEmit">
    {/* Escape skips the intro, like its Skip button. */}
    <div ref={panelRef} className="setup-intro" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") introStore.write(true); }}><OnboardingIntro onDone={() => introStore.write(true)}/></div>
  </div>;

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
