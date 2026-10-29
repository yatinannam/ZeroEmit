"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { placeLabel, type Place } from "../lib/places";
import { directionsUrl, STATIONS_RADIUS_M, type LatLon, type Station } from "../lib/stations";
import { BottomNav, TopBar } from "./app-shell";
import { Icon } from "./icon-set";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { useChargerLocation, type ChargerLocation } from "./use-charger-location";
import { useLocationPicker } from "./use-location-picker";

// Leaflet touches `window`, so the map only ever renders in the browser.
const ChargerMap = dynamic(() => import("./charger-map").then((module) => module.ChargerMap), { ssr: false, loading: () => <div className="charger-map charger-map-loading">Loading map…</div> });

type StationsState = { status: "loading" } | { status: "ready"; stations: Station[]; origin: LatLon; nearYou: boolean; updatedAt: string | null } | { status: "error" };

// Chargers near the user's (rounded) position when shared, otherwise near the
// chosen city's centre. The result is tagged with its query, so a response for
// an earlier place never shows under a newer one. Nothing is fetched until
// the saved place is known (`ready`); `retry` asks again after an error.
function useStations(place: Place, location: ChargerLocation, ready: boolean): { state: StationsState; retry: () => void } {
  const params: Record<string, string> = location.status === "on" ? { lat: String(location.lat), lon: String(location.lon) } : { state: place.state, city: place.name };
  const [attempt, setAttempt] = useState(0);
  const request = `${new URLSearchParams(params)}#${attempt}`;
  const waiting = !ready || location.status === "locating";
  const [result, setResult] = useState<{ request: string; state: StationsState } | null>(null);
  useEffect(() => {
    if (waiting) return;
    let cancelled = false;
    fetch(`/api/stations?${request.split("#")[0]}`)
      .then(async (response): Promise<StationsState> => {
        if (!response.ok) return { status: "error" };
        const body = await response.json() as { stations: Station[]; origin: LatLon; source: "location" | "city"; updatedAt?: string };
        return { status: "ready", stations: body.stations, origin: body.origin, nearYou: body.source === "location", updatedAt: body.updatedAt ?? null };
      })
      .catch((): StationsState => ({ status: "error" }))
      .then((state) => { if (!cancelled) setResult({ request, state }); });
    return () => { cancelled = true; };
  }, [request, waiting]);
  return { state: !waiting && result?.request === request ? result.state : { status: "loading" }, retry: () => setAttempt((n) => n + 1) };
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

function StationsBody({ state, retry, where, limit }: { state: StationsState; retry: () => void; where: string; limit: number }) {
  if (state.status === "loading") return <p className="personal-note">Finding chargers…</p>;
  if (state.status === "error") return <p className="personal-note">Couldn&apos;t load charger data. <button type="button" className="text-button" onClick={retry}>Try again</button></p>;
  if (!state.stations.length) return <p className="personal-note">No public chargers are mapped within {RADIUS_KM} km of {where} yet.</p>;
  return <ul className="station-list">{state.stations.slice(0, limit).map((station) => <StationRow key={station.id} station={station}/>)}</ul>;
}

// "Use my location" / "Use city centre", and what's being searched around.
function OriginControl({ place, ready, location, chooseMyLocation, chooseCityCentre }: { place: Place; ready: boolean } & ReturnType<typeof useChargerLocation>) {
  if (location.status === "on") return <p className="station-origin">Near your location (within about 1 km). <button type="button" className="text-button" onClick={chooseCityCentre}>Use {place.name} centre</button></p>;
  if (location.status === "locating") return <p className="station-origin">Finding your location…</p>;
  const note = location.status === "denied" ? "Location is blocked for this site, so this is around the city centre. " : location.status === "outside" ? "You seem to be outside India, so this is around the city centre. " : location.status === "unavailable" ? "Couldn't get your location, so this is around the city centre. " : ready ? `Around ${place.name} centre. ` : "Around the city centre. ";
  return <p className="station-origin">{note}<button type="button" className="text-button" onClick={chooseMyLocation}><Icon name="pin" size={15}/> Use my location</button></p>;
}

// The charger list is a weekly snapshot, so it says how recent it is.
function Attribution({ updatedAt }: { updatedAt: string | null }) {
  const asOf = updatedAt ? ` as of ${new Date(updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "";
  return <p className="personal-note station-credit">Charger data{asOf} and map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. It can be incomplete, so check with the operator before you go.</p>;
}

// Home: the 3 nearest chargers.
export function StationsCard({ place, ready }: { place: Place; ready: boolean }) {
  const charger = useChargerLocation();
  const { state, retry } = useStations(place, charger.location, ready);
  const nearYou = charger.location.status === "on";
  return <section className="card stat-card stations-card">
    <div className="recommendation-head"><h2>{nearYou ? "Chargers near you" : ready ? `Chargers near ${place.name}` : "Chargers nearby"}</h2><span className="chip">Within {RADIUS_KM} km</span></div>
    <OriginControl place={place} ready={ready} {...charger}/>
    <StationsBody state={state} retry={retry} where={nearYou ? "you" : place.name} limit={3}/>
    <Link className="forecast-button" href="/stations">See them on a map <Icon name="arrow" size={18}/></Link>
  </section>;
}

// /stations: a map and up to 20 nearest chargers with directions.
export function StationsScreen() {
  const { place, ready, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const charger = useChargerLocation();
  const { state, retry } = useStations(place, charger.location, ready);
  const nearYou = charger.location.status === "on";
  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/"><Icon name="arrow-left" size={18}/> Home</Link>
      <PageHeader eyebrow="Charging stations" title={nearYou ? "Chargers near you" : ready ? `Chargers near ${place.name}` : "Chargers nearby"} intro={`Public EV chargers within ${RADIUS_KM} km, nearest first${nearYou || !ready ? "" : `, measured from the centre of ${placeLabel(place)}`}.`}/>
      <OriginControl place={place} ready={ready} {...charger}/>
      {/* The map's space is held while loading, so the list below doesn't jump. */}
      {state.status === "ready" ? <ChargerMap origin={state.origin} stations={state.stations} nearYou={state.nearYou}/> : state.status === "loading" && <div className="charger-map charger-map-loading" aria-hidden="true"/>}
      <section className="card stat-card stations-card"><StationsBody state={state} retry={retry} where={nearYou ? "you" : place.name} limit={20}/></section>
      <Attribution updatedAt={state.status === "ready" ? state.updatedAt : null}/>
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
