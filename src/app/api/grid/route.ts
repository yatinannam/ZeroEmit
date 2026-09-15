import { NextRequest, NextResponse } from "next/server";
import { CITIES, City } from "../../lib/grid";

const ATLAS_URL = "https://api.energymap.in/developer/v1";
const ELECTRICITY_MAPS_URL = "https://api.electricitymaps.com/v4";

const ATLAS = "India Energy Atlas";
const ELECTRICITY_MAPS = "Electricity Maps";

const VALID_CITIES = new Set(Object.keys(CITIES));

function parseCity(raw: string | null): City | null {
  // `raw in CITIES` or `CITIES[raw]` would also match inherited Object.prototype
  // keys (e.g. ?city=constructor or ?city=__proto__), reaching the provider
  // fetches with bogus coordinates and burning the shared, rate-limited API
  // quota on garbage requests. Require an exact, own-property match instead.
  return raw && VALID_CITIES.has(raw) ? (raw as City) : null;
}

type GridPayload = { available: boolean; city: City; current?: { carbonIntensity: number; datetime: string; isEstimated: boolean }; forecast: { datetime: string; carbonIntensity: number }[]; updatedAt?: string; source: string };

// In-memory cache shared across requests/users on this server instance. Both
// configured providers are on rate-limited trial plans (the India Energy
// Atlas key caps at 3 calls/minute for the whole app, not per user), and each
// provider attempt already makes 2 upstream calls (latest + forecast), so
// without this, ordinary navigation across a few screens — or a single bad
// actor — can exhaust the shared quota for everyone. A 60s TTL keeps worst
// case upstream load well under the cap while still feeling live.
const CACHE_TTL_MS = 60_000;
const cache = new Map<City, { expiresAt: number; payload: GridPayload }>();

function unavailable(city: City, error: string, status = 503) {
  return NextResponse.json({ available: false, city, forecast: [], source: "Live grid provider", error }, { status });
}

// Best-effort extraction of the provider's own message (e.g. a 402 plan or a
// 429 rate-limit error) so the UI can show the real reason instead of a generic
// fallback. Both providers use a `detail.message` envelope on non-success.
async function providerErrorDetail(response: Response) {
  try {
    const body = await response.json() as { detail?: { message?: unknown }; error?: unknown; message?: unknown };
    const message = body?.detail?.message ?? body?.error ?? body?.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch { /* non-JSON error body */ }
  return "";
}

// Outcome of one provider attempt. `data` is set on success; otherwise
// `message`/`status` describe the failure so a later provider can be tried.
type ProviderResult = { data?: GridPayload; message: string; status: number };

async function fetchAtlas(city: City, coordinates: { state: string }, key: string): Promise<ProviderResult> {
  const headers = { "X-API-Key": key, accept: "application/json" };
  const [latestResponse, forecastResponse] = await Promise.all([
    fetch(`${ATLAS_URL}/carbon-intensity/latest?state=${coordinates.state}`, { headers }),
    fetch(`${ATLAS_URL}/forecast/carbon-intensity?state=${coordinates.state}&horizon_h=24`, { headers }),
  ]);
  if (!latestResponse.ok || !forecastResponse.ok) {
    const failing = latestResponse.ok ? forecastResponse : latestResponse;
    const detail = await providerErrorDetail(failing);
    const message = detail || (failing.status === 402 ? "Live grid forecasts require a plan with state-level data." : "Live grid data is temporarily unavailable.");
    return { message, status: failing.status === 429 ? 429 : 502 };
  }
  const latest = await latestResponse.json();
  const forecastPayload = await forecastResponse.json();
  const rawForecast: unknown = forecastPayload.forecast;
  const forecast = Array.isArray(rawForecast) ? rawForecast.filter((point: unknown): point is { ts: string; intensity_gco2_per_kwh: number } => Boolean(point && typeof point === "object" && "ts" in point && "intensity_gco2_per_kwh" in point)).map((point: { ts: string; intensity_gco2_per_kwh: number }) => ({ datetime: point.ts, carbonIntensity: point.intensity_gco2_per_kwh })) : [];
  return { data: { available: true, city, current: { carbonIntensity: latest.intensity_gco2_per_kwh, datetime: latest.as_of, isEstimated: true }, forecast, updatedAt: forecastPayload.as_of || latest.as_of, source: ATLAS }, message: "", status: 0 };
}

async function fetchElectricityMaps(city: City, coordinates: { lat: number; lon: number }, key: string): Promise<ProviderResult> {
  const query = `lat=${coordinates.lat}&lon=${coordinates.lon}`;
  const headers = { "auth-token": key, accept: "application/json" };
  const [latestResponse, forecastResponse] = await Promise.all([
    fetch(`${ELECTRICITY_MAPS_URL}/carbon-intensity/latest?${query}`, { headers }),
    fetch(`${ELECTRICITY_MAPS_URL}/carbon-intensity/forecast?${query}`, { headers }),
  ]);
  if (!latestResponse.ok || !forecastResponse.ok) {
    const failing = latestResponse.ok ? forecastResponse : latestResponse;
    const detail = await providerErrorDetail(failing);
    const message = detail || (failing.status === 401 || failing.status === 403 ? "The Electricity Maps token is invalid or unauthorized." : "Live grid data is temporarily unavailable.");
    return { message, status: failing.status === 429 ? 429 : 502 };
  }
  const latest = await latestResponse.json();
  const forecastPayload = await forecastResponse.json();
  const rawForecast: unknown = forecastPayload.forecast;
  const forecast = Array.isArray(rawForecast) ? (rawForecast as { carbonIntensity: number; datetime: string }[]).map((point) => ({ datetime: point.datetime, carbonIntensity: point.carbonIntensity })) : [];
  return { data: { available: true, city, current: { carbonIntensity: latest.carbonIntensity, datetime: latest.datetime, isEstimated: Boolean(latest.isEstimated) }, forecast, updatedAt: forecastPayload.updatedAt || latest.updatedAt, source: ELECTRICITY_MAPS }, message: "", status: 0 };
}

export async function GET(request: NextRequest) {
  const city = parseCity(request.nextUrl.searchParams.get("city"));
  if (!city) return NextResponse.json({ available: false, error: "Unsupported location", forecast: [] }, { status: 400 });
  const coordinates = CITIES[city];

  const cached = cache.get(city);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600", "X-Cache": "HIT" } });
  }

  const atlasKey = process.env.INDIA_ENERGY_ATLAS_API_KEY;
  const electricityMapsKey = process.env.ELECTRICITY_MAPS_API_KEY;
  if (!atlasKey && !electricityMapsKey) return unavailable(city, "Live grid data is not configured yet.");

  try {
    // Try each configured provider in order and use the first one that works, so
    // a broken/limited key (rate-limited or plan-restricted) falls through to the
    // next provider instead of blocking the whole app.
    let last: ProviderResult = { message: "Live grid data is temporarily unavailable.", status: 502 };
    if (atlasKey) {
      const result = await fetchAtlas(city, coordinates, atlasKey);
      if (result.data) { cache.set(city, { expiresAt: Date.now() + CACHE_TTL_MS, payload: result.data }); return NextResponse.json(result.data, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600", "X-Cache": "MISS" } }); }
      last = result;
    }
    if (electricityMapsKey) {
      const result = await fetchElectricityMaps(city, coordinates, electricityMapsKey);
      if (result.data) { cache.set(city, { expiresAt: Date.now() + CACHE_TTL_MS, payload: result.data }); return NextResponse.json(result.data, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600", "X-Cache": "MISS" } }); }
      last = result;
    }
    return unavailable(city, last.message, last.status);
  } catch {
    return unavailable(city, "Could not connect to the live grid service.", 502);
  }
}
