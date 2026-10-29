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

type StationsState = { status: "loading" } | { status: "ready"; stations: Station[]; origin: LatLon; nearYou: boolean } | { status: "error" };

// Chargers near the user's (rounded) position when shared, otherwise near the
// chosen city's centre. The result is tagged with its query, so a response for
// an earlier place never shows under a newer one.
function useStations(place: Place, location: ChargerLocation): StationsState {
  const params: Record<string, string> = location.status === "on" ? { lat: String(location.lat), lon: String(location.lon) } : { state: place.state, city: place.name };
  const request = new URLSearchParams(params).toString();
  const waiting = location.status === "locating";
  const [result, setResult] = useState<{ request: string; state: StationsState } | null>(null);
  useEffect(() => {
    if (waiting) return;
    let cancelled = false;
    fetch(`/api/stations?${request}`)
      .then(async (response): Promise<StationsState> => {
        if (!response.ok) return { status: "error" };
        const body = await response.json() as { stations: Station[]; origin: LatLon; source: "location" | "city" };
        return { status: "ready", stations: body.stations, origin: body.origin, nearYou: body.source === "location" };
      })
      .catch((): StationsState => ({ status: "error" }))
      .then((state) => { if (!cancelled) setResult({ request, state }); });
    return () => { cancelled = true; };
  }, [request, waiting]);
  return !waiting && result?.request === request ? result.state : { status: "loading" };
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

function StationsBody({ state, where, limit }: { state: StationsState; where: string; limit: number }) {
  if (state.status === "loading") return <p className="personal-note">Finding chargers… the first search for an area can take a few seconds.</p>;
  if (state.status === "error") return <p className="personal-note">Charger data is unavailable right now. Try again in a while.</p>;
  if (!state.stations.length) return <p className="personal-note">No public chargers are mapped within {RADIUS_KM} km of {where} yet.</p>;
  return <ul className="station-list">{state.stations.slice(0, limit).map((station) => <StationRow key={station.id} station={station}/>)}</ul>;
}

// "Use my location" / "Use city centre", and what's being searched around.
function OriginControl({ place, location, chooseMyLocation, chooseCityCentre }: { place: Place } & ReturnType<typeof useChargerLocation>) {
  if (location.status === "on") return <p className="station-origin">Near your location (within about 1 km). <button type="button" className="text-button" onClick={chooseCityCentre}>Use {place.name} centre</button></p>;
  if (location.status === "locating") return <p className="station-origin">Finding your location…</p>;
  const note = location.status === "denied" ? "Location is blocked for this site, so this is around the city centre. " : location.status === "unavailable" ? "Couldn't get your location, so this is around the city centre. " : `Around ${place.name} centre. `;
  return <p className="station-origin">{note}<button type="button" className="text-button" onClick={chooseMyLocation}><Icon name="pin" size={15}/> Use my location</button></p>;
}

const ATTRIBUTION = <p className="personal-note station-credit">Charger data and map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. It can be incomplete, so check with the operator before you go.</p>;

// Home: the 3 nearest chargers.
export function StationsCard({ place }: { place: Place }) {
  const charger = useChargerLocation();
  const state = useStations(place, charger.location);
  const nearYou = charger.location.status === "on";
  return <section className="card stat-card stations-card">
    <div className="recommendation-head"><h2>{nearYou ? "Chargers near you" : `Chargers near ${place.name}`}</h2><span className="chip">Within {RADIUS_KM} km</span></div>
    <OriginControl place={place} {...charger}/>
    <StationsBody state={state} where={nearYou ? "you" : place.name} limit={3}/>
    <Link className="forecast-button" href="/stations">See them on a map <Icon name="arrow" size={18}/></Link>
  </section>;
}

// /stations: a map and up to 20 nearest chargers with directions.
export function StationsScreen() {
  const { place, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const charger = useChargerLocation();
  const state = useStations(place, charger.location);
  const nearYou = charger.location.status === "on";
  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/"><Icon name="arrow-left" size={18}/> Home</Link>
      <PageHeader eyebrow="Charging stations" title={nearYou ? "Chargers near you" : `Chargers near ${place.name}`} intro={`Public EV chargers within ${RADIUS_KM} km, nearest first${nearYou ? "" : `, measured from the centre of ${placeLabel(place)}`}.`}/>
      <OriginControl place={place} {...charger}/>
      {state.status === "ready" && <ChargerMap origin={state.origin} stations={state.stations} nearYou={state.nearYou}/>}
      <section className="card stat-card stations-card"><StationsBody state={state} where={nearYou ? "you" : place.name} limit={20}/></section>
      {ATTRIBUTION}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
