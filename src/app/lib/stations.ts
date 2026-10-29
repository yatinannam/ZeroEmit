import { isInIndia, knownPlaceCoordinates } from "./places";

// Public EV chargers near a city, from OpenStreetMap (via the free Overpass
// API — no key). Coverage in India is good in big cities and patchy
// elsewhere, so the app says where the data comes from.
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

// Stations mapped as a point or as a building/area (`out center` gives the
// latter a middle point).
export function overpassQuery(origin: LatLon, radiusM = STATIONS_RADIUS_M) {
  const around = `(around:${radiusM},${origin.lat},${origin.lon})`;
  // No result cap: Overpass caps in arbitrary order, not by distance, so a cap
  // could drop the nearest chargers. parseOverpass keeps the nearest 20.
  return `[out:json][timeout:25];(node["amenity"="charging_station"]${around};way["amenity"="charging_station"]${around};);out center;`;
}

type OverpassElement = { type?: unknown; id?: unknown; lat?: unknown; lon?: unknown; center?: { lat?: unknown; lon?: unknown }; tags?: Record<string, unknown> };

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

// 2 decimal places (~1 km): close enough to find nearby chargers, coarse
// enough that an exact position never leaves the phone. Also the cache key.
export const roundCoordinate = (value: number) => Math.round(value * 100) / 100;

export type ChargerOrigin = { origin: LatLon; key: string; source: "location" | "city" };

// Where to search from: the user's (rounded) position when they share it,
// otherwise the centre of their listed city. A position that isn't a number
// or isn't in India is refused rather than quietly ignored.
export function chargerOrigin(params: { lat?: string | null; lon?: string | null; city?: string | null; state?: string | null }): ChargerOrigin | null {
  if (params.lat != null || params.lon != null) {
    const lat = Number(params.lat), lon = Number(params.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isInIndia(lat, lon)) return null;
    const origin = { lat: roundCoordinate(lat), lon: roundCoordinate(lon) };
    return { origin, key: `stations:geo:${origin.lat}:${origin.lon}`, source: "location" };
  }
  const place = { name: params.city ?? "", state: params.state ?? "" };
  const origin = knownPlaceCoordinates(place);
  return origin ? { origin, key: `stations:${place.state}:${place.name}`, source: "city" } : null;
}

export function directionsUrl({ lat, lon }: LatLon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
