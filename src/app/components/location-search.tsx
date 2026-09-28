"use client";

import { useState } from "react";
import { isInIndia, nearestPlace, POPULAR_PLACES, searchPlaces, STATES, ZONE_LABELS, zoneOf, type Place } from "../lib/places";
import { Icon } from "./icon-set";

// Shared by the location sheet and the first-run setup screen. Detection
// uses the device's position only to pick the nearest listed city — the
// coordinates themselves never leave the device.
export function LocationSearch({ current, onChoose }: { current: Place | null; onChoose: (place: Place) => void }) {
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [detectError, setDetectError] = useState("");
  const trimmed = query.trim();
  const results = trimmed ? searchPlaces(trimmed) : POPULAR_PLACES;

  function detectLocation() {
    if (!("geolocation" in navigator)) { setDetectError("This browser can't share your location. Search for your city instead."); return; }
    setDetectError("");
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      setLocating(false);
      const { latitude, longitude } = position.coords;
      if (!isInIndia(latitude, longitude)) { setDetectError("You appear to be outside India. ZeroEmit covers India's grid, so search for a city instead."); return; }
      const { name, state } = nearestPlace(latitude, longitude);
      onChoose({ name, state });
    }, (error) => {
      setLocating(false);
      setDetectError(error.code === error.PERMISSION_DENIED ? "Location access is off for this site. Allow it in your browser settings, or search for your city." : "Couldn't get your location. Try again, or search for your city.");
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 });
  }

  return <div className="location-search">
    <button type="button" className="detect-button" onClick={detectLocation} disabled={locating}><Icon name="target" size={18}/> {locating ? "Finding your location…" : "Use current location"}</button>
    {detectError && <p className="form-error" role="alert">{detectError}</p>}
    <label className="search-field"><Icon name="search" size={18}/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search city or state" aria-label="Search city or state" autoComplete="off" enterKeyHint="search"/></label>
    <p className="search-caption">{trimmed ? (results.length ? "Results" : "") : "Popular cities"}</p>
    {results.length ? <ul className="place-results">
      {results.map((place) => {
        const selected = current?.name === place.name && current.state === place.state;
        return <li key={`${place.name}-${place.state}`}><button type="button" className={selected ? "selected" : ""} aria-current={selected || undefined} onClick={() => onChoose(place)}>
          <span><strong>{place.name}</strong><small>{STATES[place.state].name} · {ZONE_LABELS[zoneOf(place)]}</small></span>
          {selected && <Icon name="check" size={18}/>}
        </button></li>;
      })}
    </ul> : <p className="personal-note">No match for &ldquo;{trimmed}&rdquo;. Try a larger city nearby, or your state&apos;s name — any city in the same state uses the same grid data.</p>}
  </div>;
}
