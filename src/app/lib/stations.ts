import { isInIndia, knownPlaceCoordinates } from "./places";

// Public EV chargers from OpenStreetMap. The free Overpass API is too slow
// and flaky to ask per visit (20 s or rate-limited from India), so a snapshot
// of every charger in India ships with the app (lib/server/chargers-india.json,
// refreshed weekly by scripts/fetch-chargers.ts) and nearby ones are picked
// from it. Coverage in India is good in big cities and patchy elsewhere, so
// the app says where the data comes from.
export type LatLon = { lat: number; lon: number };
export type Station = { id: string; name: string; operator: string | null; lat: number; lon: number; distanceKm: number; connectors: string[]; open24h: boolean };

// 30 km: mapped chargers in India are sparse outside city centres (e.g. only
// 4 within 30 km of SRM KTR, the nearest 17.7 km away), so 15 km often found none.
export const STATIONS_RADIUS_M = 30_000;
const MAX_STATIONS = 20;

// OpenStreetMap socket tags, as drivers know the connectors.
const CONNECTORS: [tag: string, label: string][] = [
  ["socket:type2_combo", "CCS2"],
  ["socket:type2", "Type 2"],
  ["socket:chademo", "CHAdeMO"],
  ["socket:gb_t", "GB/T"],
  ["socket:type1_combo", "CCS1"],
  ["socket:type1", "Type 1"],
];

export function distanceKm(a: LatLon, b: LatLon) {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Every charging station in India, mapped as a point or as a building/area
// (`out center` gives the latter a middle point).
export const INDIA_CHARGERS_QUERY = `[out:json][timeout:180];area["ISO3166-1"="IN"][admin_level=2]->.in;nwr["amenity"="charging_station"](area.in);out center tags;`;

type OverpassElement = { type?: unknown; id?: unknown; lat?: unknown; lon?: unknown; center?: { lat?: unknown; lon?: unknown }; tags?: Record<string, unknown> };
export type ChargerElement = { type: string; id: number; lat: number; lon: number; tags: Record<string, string> };

// Only what the app shows survives into the snapshot.
const KEPT_TAGS = ["name", "name:en", "operator", "brand", "opening_hours", ...CONNECTORS.map(([tag]) => tag)];

// An Overpass answer, trimmed for the snapshot: a flat position, the kept
// tags, sorted by id so a refresh only changes the lines that changed.
export function compactChargers(response: unknown): ChargerElement[] {
  const elements = (response as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: ChargerElement[] = [];
  for (const raw of elements as OverpassElement[]) {
    const lat = typeof raw.lat === "number" ? raw.lat : raw.center?.lat;
    const lon = typeof raw.lon === "number" ? raw.lon : raw.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number" || typeof raw.type !== "string" || typeof raw.id !== "number") continue;
    const tags: Record<string, string> = {};
    for (const key of KEPT_TAGS) { const value = raw.tags?.[key]; if (typeof value === "string") tags[key] = value; }
    out.push({ type: raw.type, id: raw.id, lat, lon, tags });
  }
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
}

export function parseOverpass(response: unknown, origin: LatLon): Station[] {
  const elements = (response as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const stations: Station[] = [];
  for (const raw of elements as OverpassElement[]) {
    const lat = typeof raw.lat === "number" ? raw.lat : raw.center?.lat;
    const lon = typeof raw.lon === "number" ? raw.lon : raw.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const tags = raw.tags ?? {};
    const text = (key: string) => (typeof tags[key] === "string" && (tags[key] as string).trim() ? (tags[key] as string).trim() : null);
    const operator = text("operator") ?? text("brand");
    stations.push({
      id: `${String(raw.type)}/${String(raw.id)}`,
      name: text("name") ?? text("name:en") ?? operator ?? "EV charging station",
      operator,
      lat,
      lon,
      distanceKm: Math.round(distanceKm(origin, { lat, lon }) * 10) / 10,
      connectors: CONNECTORS.filter(([tag]) => { const value = text(tag); return value !== null && value !== "no" && value !== "0"; }).map(([, label]) => label),
      open24h: text("opening_hours") === "24/7",
    });
  }
  return stations.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, MAX_STATIONS);
}

// The nearest chargers (up to 20) within `radiusKm` of `origin`.
export function nearbyStations(snapshot: unknown[], origin: LatLon, radiusKm = STATIONS_RADIUS_M / 1000): Station[] {
  return parseOverpass({ elements: snapshot }, origin).filter((station) => station.distanceKm <= radiusKm);
}

// 2 decimal places (~1 km): close enough to find nearby chargers, coarse
// enough that an exact position never leaves the phone.
export const roundCoordinate = (value: number) => Math.round(value * 100) / 100;

export type ChargerOrigin = { origin: LatLon; source: "location" | "city" };

// Where to search from: the user's (rounded) position when they share it,
// otherwise the centre of their listed city. A position that isn't a number
// or isn't in India is refused rather than quietly ignored.
export function chargerOrigin(params: { lat?: string | null; lon?: string | null; city?: string | null; state?: string | null }): ChargerOrigin | null {
  if (params.lat != null || params.lon != null) {
    const lat = Number(params.lat), lon = Number(params.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isInIndia(lat, lon)) return null;
    const origin = { lat: roundCoordinate(lat), lon: roundCoordinate(lon) };
    return { origin, source: "location" };
  }
  const place = { name: params.city ?? "", state: params.state ?? "" };
  const origin = knownPlaceCoordinates(place);
  return origin ? { origin, source: "city" } : null;
}

export function directionsUrl({ lat, lon }: LatLon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
