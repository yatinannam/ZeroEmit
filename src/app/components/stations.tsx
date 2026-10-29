"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { placeLabel, type Place } from "../lib/places";
import { directionsUrl, STATIONS_RADIUS_M, type Station } from "../lib/stations";
import { BottomNav, TopBar } from "./app-shell";
import { Icon } from "./icon-set";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { useLocationPicker } from "./use-location-picker";

type StationsState = { status: "loading" } | { status: "ready"; stations: Station[] } | { status: "error" };

// Chargers near the chosen city. The result is tagged with its city, so a
// response for the previous city never shows under a new one.
function useStations(place: Place): StationsState {
  const request = `${place.state}|${place.name}`;
  const [result, setResult] = useState<{ request: string; state: StationsState } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stations?${new URLSearchParams({ state: place.state, city: place.name })}`)
      .then(async (response): Promise<StationsState> => (response.ok ? { status: "ready", stations: (await response.json() as { stations: Station[] }).stations } : { status: "error" }))
      .catch((): StationsState => ({ status: "error" }))
      .then((state) => { if (!cancelled) setResult({ request, state }); });
    return () => { cancelled = true; };
  }, [place.state, place.name, request]);
  return result?.request === request ? result.state : { status: "loading" };
}

const RADIUS_KM = STATIONS_RADIUS_M / 1000;

function StationRow({ station }: { station: Station }) {
  const details = [station.operator && station.operator !== station.name ? station.operator : null, `${station.distanceKm.toFixed(1)} km`, station.connectors.join(", ") || null, station.open24h ? "Open 24/7" : null].filter(Boolean).join(" · ");
  return <li className="station-row">
    <span className="round-icon"><Icon name="bolt" size={18}/></span>
    <span className="station-text"><strong>{station.name}</strong><small>{details}</small></span>
    <a className="station-directions" href={directionsUrl(station)} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${station.name}`}><Icon name="arrow" size={18}/></a>
  </li>;
}

function StationsBody({ state, place, limit }: { state: StationsState; place: Place; limit: number }) {
  if (state.status === "loading") return <p className="personal-note">Finding chargers…</p>;
  if (state.status === "error") return <p className="personal-note">Charger data is unavailable right now. Try again in a while.</p>;
  if (!state.stations.length) return <p className="personal-note">No public chargers are mapped within {RADIUS_KM} km of {place.name} yet.</p>;
  return <ul className="station-list">{state.stations.slice(0, limit).map((station) => <StationRow key={station.id} station={station}/>)}</ul>;
}

const ATTRIBUTION = <p className="personal-note station-credit">Charger data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. It can be incomplete, so check with the operator before you go.</p>;

// Home: the 3 nearest chargers.
export function StationsCard({ place }: { place: Place }) {
  const state = useStations(place);
  return <section className="card stat-card stations-card">
    <div className="recommendation-head"><h2>Chargers near {place.name}</h2><span className="chip">Within {RADIUS_KM} km</span></div>
    <StationsBody state={state} place={place} limit={3}/>
    <Link className="forecast-button" href="/stations">See all chargers <Icon name="arrow" size={18}/></Link>
  </section>;
}

// /stations: up to 20 nearest chargers with directions.
export function StationsScreen() {
  const { place, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const state = useStations(place);
  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/"><Icon name="arrow-left" size={18}/> Home</Link>
      <PageHeader eyebrow="Charging stations" title={`Chargers near ${place.name}`} intro={`Public EV chargers within ${RADIUS_KM} km of ${placeLabel(place)}, nearest first. Distances are from the city centre.`}/>
      <section className="card stat-card stations-card"><StationsBody state={state} place={place} limit={20}/></section>
      {ATTRIBUTION}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
