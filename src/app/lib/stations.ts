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
// Most listed cities have no mapped charger within the radius (Jaipur's
// nearest is ~97 km away), so the nearest few beyond it are offered instead.
const FARTHER_STATIONS = 3;

// What a charger is called when OpenStreetMap has no name, operator or brand
// for it (about a third of India's).
export const UNNAMED_STATION = "Unnamed EV charger";

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

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

// Which way `to` lies from `from`, to the nearest of 8 compass points.
export function compassDirection(from: LatLon, to: LatLon) {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const y = Math.sin(rad(to.lon - from.lon)) * Math.cos(rad(to.lat));
  const x = Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) - Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lon - from.lon));
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((bearing + 360) % 360) / 45) % 8];
}

// OpenStreetMap's operator/brand tags are typed by hand, so one network shows
// up as "tata", "Tata power" and "tata power". Known networks get their own
// spelling; tags that only say "charging station" count as no operator;
// anything else typed all in lower case is title-cased.
const OPERATOR_ALIASES: Record<string, string | null> = {
  "tata": "Tata Power", "tata power": "Tata Power", "tata power charging station": "Tata Power", "tata power ez charge": "Tata Power EZ Charge",
  "ather": "Ather Energy", "ather energy": "Ather Energy", "ather grid": "Ather Grid",
  "eesl": "EESL", "energy efficiency services limited eesl": "EESL",
  "electriva": "ElectriVa", "chargezone": "ChargeZone", "charge zone": "ChargeZone", "charge zone charging station": "ChargeZone",
  "go ec": "GO EC", "goec": "GO EC", "goec charging station": "GO EC", "go ego": "goEgo", "goego": "goEgo", "goego charging station": "goEgo",
  "jio bp": "Jio-bp pulse", "jio bp pulse": "Jio-bp pulse", "jio pulse": "Jio-bp pulse", "jio bp pulse ev charging station": "Jio-bp pulse",
  "kseb": "KSEB", "kseb charging station": "KSEB", "kerala state electricity board": "KSEB",
  "vida": "Vida", "hero vida": "Vida", "zeon": "Zeon Charging", "zeon charging": "Zeon Charging", "zeon network": "Zeon Charging", "zeon charging station": "Zeon Charging", "zeon power": "Zeon Charging",
  "indian oil": "Indian Oil", "indian oils": "Indian Oil", "iocl": "Indian Oil", "hindustan petroleum": "Hindustan Petroleum", "hp echarge": "HP eCharge", "hp echarge ev charging station": "HP eCharge",
  "ola electric": "Ola Electric", "ola fast charger": "Ola Electric", "ola hypercharger": "Ola Electric", "bolt": "Bolt.Earth", "bolt earth": "Bolt.Earth", "tesla supercharger": "Tesla",
  "ev charging station": null, "electric vehicle charging station": null, "charging station": null, "ev charger": null, "plug share": null, "plugshare": null,
};

const aliasKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const titleCase = (text: string) => (text === text.toLowerCase() ? text.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase()).replace(/\bEv\b/g, "EV") : text);

export function normalizeOperator(raw: string | null): string | null {
  if (!raw) return null;
  const key = aliasKey(raw);
  return key in OPERATOR_ALIASES ? OPERATOR_ALIASES[key] : titleCase(raw);
}

// A name that only says what it is ("Electric Vehicle Charging Station") is
// no name at all; the operator says more.
const GENERIC_NAME = /^(ev|e vehicle|electric vehicle)? ?(charging|charge|charger)( station| point)?$/;
const stationName = (raw: string | null) => (raw && !GENERIC_NAME.test(aliasKey(raw)) ? titleCase(raw) : null);

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
    // Tidied here, as the app serves them, so the snapshot keeps OSM's own tags.
    const operator = normalizeOperator(text("operator")) ?? normalizeOperator(text("brand"));
    stations.push({
      id: `${String(raw.type)}/${String(raw.id)}`,
      name: stationName(text("name")) ?? stationName(text("name:en")) ?? operator ?? UNNAMED_STATION,
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
  return stationsAround(snapshot, origin, radiusKm).stations;
}

// The nearest chargers within `radiusKm` and, only when there are none, the
// nearest 3 beyond it (`farther`), so a small city isn't a dead end.
export function stationsAround(snapshot: unknown[], origin: LatLon, radiusKm = STATIONS_RADIUS_M / 1000): { stations: Station[]; farther: Station[] } {
  const nearest = parseOverpass({ elements: snapshot }, origin);
  const stations = nearest.filter((station) => station.distanceKm <= radiusKm);
  return { stations, farther: stations.length ? [] : nearest.slice(0, FARTHER_STATIONS) };
}

// Google Maps' own search for chargers, for when OpenStreetMap has few.
export function chargerSearchUrl(near: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`EV charging station near ${near}`)}`;
}

// OpenStreetMap's editor at `at`, for adding a charger that's missing.
export function addChargerUrl({ lat, lon }: LatLon) {
  return `https://www.openstreetmap.org/edit#map=15/${lat}/${lon}`;
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
