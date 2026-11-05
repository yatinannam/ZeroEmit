"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { placeLabel, type Place } from "../lib/places";
import { addChargerUrl, chargerSearchUrl, compassDirection, connectorsIn, directionsUrl, networksIn, STATIONS_RADIUS_M, type LatLon, type Station } from "../lib/stations";
import { BottomNav, TopBar } from "./app-shell";
import { Icon } from "./icon-set";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { useChargerLocation, type ChargerLocation } from "./use-charger-location";
import { useLocationPicker } from "./use-location-picker";

// Leaflet touches `window`, so the map only ever renders in the browser.
const ChargerMap = dynamic(() => import("./charger-map").then((module) => module.ChargerMap), { ssr: false, loading: () => <div className="charger-map charger-map-loading">Loading map…</div> });

// `farther`: with no charger in range, the nearest few beyond it.
type StationsState = { status: "loading" } | { status: "ready"; stations: Station[]; farther: Station[]; origin: LatLon; nearYou: boolean; updatedAt: string | null } | { status: "error" };

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
        const body = await response.json() as { stations: Station[]; farther?: Station[]; origin: LatLon; source: "location" | "city"; updatedAt?: string };
        return { status: "ready", stations: body.stations, farther: body.farther ?? [], origin: body.origin, nearYou: body.source === "location", updatedAt: body.updatedAt ?? null };
      })
      .catch((): StationsState => ({ status: "error" }))
      .then((state) => { if (!cancelled) setResult({ request, state }); });
    return () => { cancelled = true; };
  }, [request, waiting]);
  return { state: !waiting && result?.request === request ? result.state : { status: "loading" }, retry: () => setAttempt((n) => n + 1) };
}

const RADIUS_KM = STATIONS_RADIUS_M / 1000;

// The whole row opens directions; its number matches the pin on the map.
function StationRow({ station, number, origin }: { station: Station; number: number; origin: LatLon }) {
  const away = `${station.distanceKm.toFixed(1)} km${station.distanceKm >= 0.1 ? ` ${compassDirection(origin, station)}` : ""}`;
  const details = [station.operator && station.operator.toLowerCase() !== station.name.toLowerCase() ? station.operator : null, away, station.connectors.join(", ") || null, station.open24h ? "Open 24/7" : null].filter((part): part is string => Boolean(part));
  return <li>
    <a className="station-row" href={directionsUrl(station)} target="_blank" rel="noopener noreferrer" aria-label={`${number}. ${station.name}, ${details.join(", ")}. Directions (opens in a new tab)`}>
      <span className="round-icon station-number" aria-hidden="true">{number}</span>
      <span className="station-text"><strong>{station.name}</strong><small>{details.join(" · ")}</small></span>
      <span className="station-directions" aria-hidden="true"><Icon name="navigation" size={18}/></span>
    </a>
  </li>;
}

function StationList({ stations, origin }: { stations: Station[]; origin: LatLon }) {
  return <ol className="station-list">{stations.map((station, index) => <StationRow key={station.id} station={station} number={index + 1} origin={origin}/>)}</ol>;
}

// `where` reads "you" or the city; `searchNear` is what Google Maps is asked
// to search around. The message sits in a live region that's always there, so
// screen readers hear "Finding chargers…" and then what was found.
function StationsBody({ state, retry, where, searchNear, limit }: { state: StationsState; retry: () => void; where: string; searchNear: string; limit: number }) {
  const found = state.status === "ready" && state.stations.length > 0;
  const shown = state.status === "ready" ? Math.min(state.stations.length, limit) : 0;
  const message = state.status === "loading" ? <p className="personal-note">Finding chargers…</p>
    : state.status === "error" ? <p className="personal-note">Couldn&apos;t load charger data. <button type="button" className="text-button" onClick={retry}>Try again</button></p>
    : found ? `${shown === 1 ? "1 charger" : `${shown} chargers`} within ${RADIUS_KM} km of ${where}, nearest first.`
    : <p className="personal-note">No public chargers are mapped within {RADIUS_KM} km of {where} yet.{state.farther.length ? " The nearest mapped ones are farther away:" : ""}</p>;
  return <>
    <div role="status" className={found ? "sr-only" : undefined}>{message}</div>
    {state.status === "ready" && (found ? <StationList stations={state.stations.slice(0, limit)} origin={state.origin}/> : <>
      {state.farther.length > 0 && <StationList stations={state.farther} origin={state.origin}/>}
      {/* OpenStreetMap is thin outside big cities, so point to Google's listings and to adding a charger. */}
      <p className="station-links"><a href={chargerSearchUrl(searchNear)} target="_blank" rel="noopener noreferrer">Search EV chargers in Google Maps</a><a href={addChargerUrl(state.origin)} target="_blank" rel="noopener noreferrer">Add one on OpenStreetMap</a></p>
    </>)}
  </>;
}

// "Use my location" / "Use city centre", and what's being searched around.
// It's a live region too, as tapping either button changes what it says.
function OriginControl({ place, ready, location, chooseMyLocation, chooseCityCentre }: { place: Place; ready: boolean } & ReturnType<typeof useChargerLocation>) {
  const centre = ready ? `${place.name} centre` : "city centre";
  const centreButton = <button type="button" className="text-button" onClick={chooseCityCentre}>Use {centre}</button>;
  if (location.status === "on") return <p className="station-origin" role="status">Using your approximate location. {centreButton}</p>;
  // A permission prompt can sit unanswered, so the city centre is one tap away.
  if (location.status === "locating") return <p className="station-origin" role="status">Finding your location… {centreButton}</p>;
  // Once blocked, the browser refuses at once without asking, so say how to unblock it.
  if (location.status === "denied") return <p className="station-origin" role="status">{location.again ? "Still blocked. " : ""}Location access is off for this site, so this is around the {centre}. Allow it in your browser settings, then <button type="button" className="text-button" onClick={chooseMyLocation}>try again</button></p>;
  const note = location.status === "outside" ? "You seem to be outside India, so this is around the city centre. " : location.status === "unavailable" ? "Couldn't get your location, so this is around the city centre. " : `Around the ${centre}. `;
  return <p className="station-origin" role="status">{note}<button type="button" className="text-button" onClick={chooseMyLocation}><Icon name="pin" size={15}/> Use my location</button></p>;
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
  // With none in range, the map shows the nearest farther away (if any).
  const noneInRange = state.status === "ready" && !state.stations.length;
  const mapLink = noneInRange ? (state.farther.length ? "See the nearest on a map" : null) : "See them on a map";
  return <section className="card stat-card stations-card">
    <div className="recommendation-head"><h2>{nearYou ? "Chargers near you" : ready ? `Chargers near ${place.name}` : "Chargers nearby"}</h2><span className="chip">Within {RADIUS_KM} km</span></div>
    <OriginControl place={place} ready={ready} {...charger}/>
    <StationsBody state={state} retry={retry} where={nearYou ? "you" : place.name} searchNear={nearYou ? "me" : placeLabel(place)} limit={3}/>
    {mapLink && <Link className="forecast-button" href="/stations">{mapLink} <Icon name="arrow" size={18}/></Link>}
    <p className="personal-note station-credit">Charger data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></p>
  </section>;
}

// /stations: a map and up to 20 nearest chargers with directions.
export function StationsScreen() {
  const { place, ready, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const charger = useChargerLocation();
  const { state, retry } = useStations(place, charger.location, ready);
  const nearYou = charger.location.status === "on";
  // Picking a city here means "show me chargers there", even with "Use my
  // location" on, so the list follows the toast's "Location set to …".
  const chooseCity = (next: Place) => { chooseLocation(next); charger.chooseCityCentre(); };
  // Filter by network (most chargers name one) or by connector (few list
  // them), among what the chargers found here have. A connector filter also
  // says how many it had to leave out for listing none.
  type Filter = { kind: "network" | "connector"; value: string };
  const [filter, setFilter] = useState<Filter | null>(null);
  const options: Filter[] = state.status === "ready" ? [...networksIn(state.stations).map((value) => ({ kind: "network" as const, value })), ...connectorsIn(state.stations).map((value) => ({ kind: "connector" as const, value }))] : [];
  const active = filter && options.some((option) => option.kind === filter.kind && option.value === filter.value) ? filter : null;
  const matches = (station: Station) => !active || (active.kind === "network" ? station.operator === active.value : station.connectors.includes(active.value));
  const shown: StationsState = state.status === "ready" && active ? { ...state, stations: state.stations.filter(matches) } : state;
  const unlisted = state.status === "ready" && active?.kind === "connector" ? state.stations.filter((station) => !station.connectors.length).length : 0;
  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="EV chargers" title={nearYou ? "Chargers near you" : ready ? `Chargers near ${place.name}` : "Chargers nearby"} intro={`Public EV chargers within ${RADIUS_KM} km, nearest first${nearYou || !ready ? "" : `, measured from the centre of ${placeLabel(place)}`}.`}/>
      <OriginControl place={place} ready={ready} {...charger}/>
      {/* The map's space is held while loading, so the list below doesn't jump. With none in range it shows the nearest farther away. */}
      {options.length > 1 && <div className="connector-filter" role="group" aria-label="Filter chargers by network or connector">
        <button type="button" aria-pressed={active === null} className={active === null ? "active" : ""} onClick={() => setFilter(null)}>All</button>
        {options.map((option) => { const on = active?.kind === option.kind && active.value === option.value; return <button key={`${option.kind}:${option.value}`} type="button" aria-pressed={on} className={`${on ? "active" : ""}${option.kind === "connector" ? " connector-option" : ""}`} onClick={() => setFilter(option)}>{option.kind === "connector" ? <><Icon name="plug" size={14}/> {option.value}</> : option.value}</button>; })}
      </div>}
      {shown.status === "ready" ? <ChargerMap origin={shown.origin} stations={shown.stations.length ? shown.stations : shown.farther} nearYou={shown.nearYou}/> : shown.status === "loading" && <div className="charger-map charger-map-loading" aria-hidden="true"/>}
      <section className="card stat-card stations-card">
        <StationsBody state={shown} retry={retry} where={nearYou ? "you" : place.name} searchNear={nearYou ? "me" : placeLabel(place)} limit={20}/>
        {active && unlisted > 0 && <p className="personal-note">{unlisted} {unlisted === 1 ? "charger doesn't" : "chargers don't"} list their connectors and {unlisted === 1 ? "is" : "are"} left out. <button type="button" className="text-button" onClick={() => setFilter(null)}>Show all</button></p>}
      </section>
      <Attribution updatedAt={state.status === "ready" ? state.updatedAt : null}/>
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseCity}/>}
  </div>;
}
