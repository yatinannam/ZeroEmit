import { HOUR_MS, istDayKey, istHourStart, IST_TIME_ZONE, type ForecastPoint, type GridData } from "../grid";
import { STATES, type Zone } from "../places";
import { redis, redisConfigured } from "./redis";

const ATLAS_URL = "https://api.energymap.in/developer/v1";
const ELECTRICITY_MAPS_URL = "https://api.electricitymaps.com/v4";

const ATLAS = "India Energy Atlas";
const ELECTRICITY_MAPS = "Electricity Maps";

export type GridPayload = Omit<GridData, "error">;

// In-memory cache shared across requests/users on this server instance. Both
// configured providers are on rate-limited trial plans (the India Energy
// Atlas key caps at 3 calls/minute for the whole app, not per user), and each
// provider attempt already makes 2 upstream calls (latest + forecast), so
// without this, ordinary navigation across a few screens — or a single bad
// actor — can exhaust the shared quota for everyone. A 60s TTL keeps worst
// case upstream load well under the cap while still feeling live.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; payload: GridPayload }>();

type AtlasLatestItem = { carbon_intensity_gco2_kwh: number; timestamp: string; intensity_class?: string };
type ZoneSnapshot = { latest: AtlasLatestItem | null; pattern: (number | null)[] | null; fetchedAt: number };

// Forecast is Pro-plan-gated on the trial key this app ships with, so it
// fails the same way on (almost) every request. Cache the outcome per state
// to avoid burning the shared 3-calls/minute quota on a call we can predict
// will fail — for hours when the plan refuses it (401/402/403), since that
// won't change until the plan does; briefly otherwise.
const FORECAST_CACHE_TTL_MS = 5 * 60_000;
const FORECAST_REFUSED_TTL_MS = 6 * HOUR_MS;
const forecastCache = new Map<string, { expiresAt: number; forecast: ForecastPoint[] }>();

// Live forecast needs the Pro plan, but the free Sandbox tier's by-zone
// endpoint supports up to 30 days of hourly history in one call — which
// already contains everything needed for "latest" too (items are ordered
// newest-first). Average real historical readings by hour-of-day (IST) to
// build a "typical day" curve per zone as a forecast fallback: real data,
// not a fabricated guess, just not live.
//
// Every state in a regional grid (e.g. Tamil Nadu and Karnataka, both
// Southern) shares this zone-level data, so it's cached by zone: in memory,
// and in Redis when configured so serverless instances and the push
// scheduler share it too.
//
// The trial key allows 100 calls a day for the whole app, and the data only
// updates hourly, so each region refreshes at most hourly, only one request
// refreshes a region at a time, and a counter in Redis stops all calls at
// ATLAS_DAILY_BUDGET per IST day. When a refresh isn't possible, the last
// good snapshot is served: its typical pattern stays valid for hours, and its
// reading counts as "right now" while it's under LATEST_MAX_AGE_MS old.
const ZONE_DATA_HISTORY_HOURS = 336; // 14 days, for the typical-pattern average
const ZONE_REFRESH_MS = 60 * 60_000;
const LATEST_MAX_AGE_MS = 90 * 60_000;
const ZONE_REDIS_TTL_S = 24 * 60 * 60; // the pattern stays useful long after "latest" is stale
const UPSTREAM_TIMEOUT_MS = 10_000;
export const ATLAS_DAILY_BUDGET = 90;
// The forecast endpoint needs the Pro plan; the trial key is always refused,
// so it's only called when explicitly enabled.
const FORECAST_ENABLED = process.env.INDIA_ENERGY_ATLAS_FORECAST === "1";
const zoneDataCache = new Map<string, ZoneSnapshot>();
const zoneRefreshes = new Map<string, Promise<{ snapshot: ZoneSnapshot | null; status: number; calledUpstream: boolean }>>();

// For tests: forget everything this instance has cached.
export function resetGridSourceMemory() {
  cache.clear();
  forecastCache.clear();
  zoneDataCache.clear();
  zoneRefreshes.clear();
}

// Counts one provider call against today's (IST) budget; false once spent.
// Without Redis (local development) there's nothing shared to count.
async function spendAtlasCall(now = Date.now()) {
  if (!redisConfigured) return true;
  try {
    const key = `atlas:calls:${istDayKey(now)}`;
    const count = await redis<number>("INCR", key);
    if (count === 1) await redis("EXPIRE", key, 2 * 24 * 60 * 60);
    return count <= ATLAS_DAILY_BUDGET;
  } catch {
    return true;
  }
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
export type ProviderResult = { data?: GridPayload; message: string; status: number };

// Shared by the zone and national-aggregate lookups so both get the same
// validation — an unvalidated item from either path can otherwise carry
// undefined numeric/string fields straight into the UI as "NaN gCO₂/kWh".
function parseLatestItem(raw: unknown): AtlasLatestItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.carbon_intensity_gco2_kwh !== "number" || typeof item.timestamp !== "string") return null;
  return { carbon_intensity_gco2_kwh: item.carbon_intensity_gco2_kwh, timestamp: item.timestamp, intensity_class: typeof item.intensity_class === "string" ? item.intensity_class : undefined };
}

// The newest by-zone row is often the hour still being filled in: it's
// modelled from whatever inputs have arrived so far, so its total generation
// is well short of a complete hour (e.g. 65 GW against ~87 GW) and its
// intensity comes out far too low (230 against a settled 558). Used as
// "current", that made charging *now* look cleaner than every forecast hour,
// every time. Drop leading rows that are in the future or whose generation
// falls under 90% of the hour before — complete hours almost never do (2 of
// 335 over 14 days in the Western grid, and skipping one of those only means
// showing the previous hour's reading).
const PROVISIONAL_GENERATION_RATIO = 0.9;
function completeItems(items: unknown[], now = Date.now()): unknown[] {
  const generation = (raw: unknown) => (raw && typeof raw === "object" && typeof (raw as { total_generation_mw?: unknown }).total_generation_mw === "number" ? (raw as { total_generation_mw: number }).total_generation_mw : null);
  let start = 0;
  while (start < Math.min(2, items.length - 1)) {
    const item = parseLatestItem(items[start]);
    const current = generation(items[start]);
    const previous = generation(items[start + 1]);
    const inFuture = item !== null && Date.parse(item.timestamp) > now;
    const partial = current !== null && previous !== null && current < previous * PROVISIONAL_GENERATION_RATIO;
    if (!inFuture && !partial) break;
    start += 1;
  }
  return items.slice(start);
}

function istHour(isoTimestamp: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: IST_TIME_ZONE }).format(new Date(isoTimestamp)));
}

function buildTypicalPattern(items: unknown[]): (number | null)[] | null {
  const sums = new Array(24).fill(0);
  const counts = new Array(24).fill(0);
  for (const raw of items) {
    const item = parseLatestItem(raw);
    if (!item) continue;
    const hour = istHour(item.timestamp);
    sums[hour] += item.carbon_intensity_gco2_kwh;
    counts[hour] += 1;
  }
  const pattern = sums.map((sum, hour) => (counts[hour] > 0 ? sum / counts[hour] : null));
  return pattern.every((value) => value === null) ? null : pattern;
}

async function readZoneFromRedis(zone: string): Promise<ZoneSnapshot | null> {
  if (!redisConfigured) return null;
  try {
    const raw = await redis<string | null>("GET", `zone:${zone}`);
    return raw ? JSON.parse(raw) as ZoneSnapshot : null;
  } catch { return null; }
}

async function fetchZoneFromUpstream(zone: string, key: string): Promise<{ snapshot: ZoneSnapshot | null; status: number }> {
  const response = await fetch(`${ATLAS_URL}/carbon-intensity/by-zone?zone=${zone}&hours=${ZONE_DATA_HISTORY_HOURS}`, { headers: { "X-API-Key": key, accept: "application/json" }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) return { snapshot: null, status: response.status };
  const payload = await response.json();
  const items = completeItems(Array.isArray(payload?.data?.items) ? payload.data.items : []);
  const snapshot: ZoneSnapshot = { latest: items.length > 0 ? parseLatestItem(items[0]) : null, pattern: buildTypicalPattern(items), fetchedAt: Date.now() };
  // Only cache a usable result — a 200 with empty/unparseable items would
  // otherwise freeze a transient failure, forcing requests into the
  // national-fallback path instead of just retrying like a normal failure.
  if (snapshot.latest) {
    zoneDataCache.set(zone, snapshot);
    if (redisConfigured) await redis("SET", `zone:${zone}`, JSON.stringify(snapshot), "EX", ZONE_REDIS_TTL_S).catch(() => undefined);
  }
  return { snapshot, status: response.status };
}

// Freshest usable zone data: memory, then Redis, then (if allowed) upstream.
// Anything younger than `maxAgeMs` is used without calling upstream. With
// `allowUpstream: false` a stale snapshot is returned as-is — its typical
// pattern is still good for hours — which the push scheduler relies on to
// stay inside the provider's limits (the trial key allows 3 calls/minute and
// 100/day for the whole app).
export async function getZoneSnapshot(zone: Zone, { allowUpstream, maxAgeMs = ZONE_REFRESH_MS }: { allowUpstream: boolean; maxAgeMs?: number }): Promise<{ snapshot: ZoneSnapshot | null; status: number; calledUpstream: boolean }> {
  const memory = zoneDataCache.get(zone);
  if (memory && Date.now() - memory.fetchedAt < maxAgeMs) return { snapshot: memory, status: 200, calledUpstream: false };
  const stored = await readZoneFromRedis(zone);
  if (stored && Date.now() - stored.fetchedAt < maxAgeMs) { zoneDataCache.set(zone, stored); return { snapshot: stored, status: 200, calledUpstream: false }; }
  const fallback = stored ?? memory ?? null;
  const key = process.env.INDIA_ENERGY_ATLAS_API_KEY;
  if (!allowUpstream || !key) return { snapshot: fallback, status: 200, calledUpstream: false };

  // Requests on this instance share one refresh; across instances, a short
  // Redis lock lets only one of them call the provider.
  const running = zoneRefreshes.get(zone);
  if (running) return { ...(await running), calledUpstream: false };
  const refresh = (async () => {
    if (redisConfigured) {
      const lock = await redis<string | null>("SET", `atlas:lock:${zone}`, "1", "NX", "EX", 30).catch(() => "OK");
      if (lock === null) return { snapshot: fallback, status: 200, calledUpstream: false };
    }
    if (!(await spendAtlasCall())) return { snapshot: fallback, status: 429, calledUpstream: false };
    const fresh = await fetchZoneFromUpstream(zone, key).catch(() => ({ snapshot: null, status: 502 }));
    if (fresh.snapshot?.latest) return { ...fresh, calledUpstream: true };
    return { snapshot: fallback, status: fresh.status, calledUpstream: true };
  })();
  zoneRefreshes.set(zone, refresh);
  try { return await refresh; } finally { zoneRefreshes.delete(zone); }
}

// "Latest" older than this is no longer treated as the current reading.
export function isFresh(snapshot: ZoneSnapshot, maxAgeMs = LATEST_MAX_AGE_MS) {
  return Date.now() - snapshot.fetchedAt < maxAgeMs;
}

// Projects the typical-day pattern onto real clock hours, from the top of the
// current IST hour through the end of tomorrow (IST), so it can be split into
// "today" and "tomorrow" and run through topWindows() like a real forecast.
// Points sit on whole IST hours (IST is UTC+5:30, so flooring in UTC would
// land on :30). topWindows() treats consecutive entries as consecutive clock
// hours — skipping an hour whose bucket had no historical samples would make
// it silently pick two points that aren't actually adjacent and call the gap
// a contiguous "2-hour window". Every hour gets a point; an unsampled one
// falls back to the average of the hours that do have data.
export function projectTypicalForecast(pattern: (number | null)[]): ForecastPoint[] {
  const known = pattern.filter((value): value is number => value !== null);
  if (known.length === 0) return [];
  const fallback = known.reduce((sum, value) => sum + value, 0) / known.length;
  const currentHourStart = istHourStart(Date.now());
  const hoursLeftToday = 24 - istHour(new Date(currentHourStart).toISOString());
  const points: ForecastPoint[] = [];
  for (let i = 0; i < hoursLeftToday + 24; i += 1) {
    const start = new Date(currentHourStart + i * HOUR_MS).toISOString();
    points.push({ datetime: start, carbonIntensity: pattern[istHour(start)] ?? fallback });
  }
  return points;
}

async function fetchStateForecast(state: string, headers: Record<string, string>): Promise<ForecastPoint[]> {
  const cached = forecastCache.get(state);
  if (cached && cached.expiresAt > Date.now()) return cached.forecast;
  // Optional extra: a timeout or network error means no forecast, never a
  // failed request for the zone data fetched alongside it.
  const response = await fetch(`${ATLAS_URL}/forecast/carbon-intensity?state=${state}&horizon_h=24`, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }).catch(() => null);
  let forecast: ForecastPoint[] = [];
  if (response?.ok) {
    const payload = await response.json().catch(() => null);
    const rawForecast: unknown = payload?.forecast;
    forecast = Array.isArray(rawForecast) ? rawForecast.filter((point: unknown): point is { ts: string; intensity_gco2_per_kwh: number } => Boolean(point && typeof point === "object" && "ts" in point && "intensity_gco2_per_kwh" in point)).map((point: { ts: string; intensity_gco2_per_kwh: number }) => ({ datetime: point.ts, carbonIntensity: point.intensity_gco2_per_kwh })) : [];
  }
  const refused = response !== null && [401, 402, 403].includes(response.status);
  forecastCache.set(state, { expiresAt: Date.now() + (refused ? FORECAST_REFUSED_TTL_MS : FORECAST_CACHE_TTL_MS), forecast });
  return forecast;
}

// State-level "latest" and any forecast need the Pro plan and above; only
// zone-level "latest" (5 regional grids) is real data on the free Sandbox
// tier the app ships with by default. Use zone-latest as the primary source
// (falling back to the always-available all-India aggregate if it fails
// outright), and treat forecast as best-effort — a plan-restricted forecast
// degrades to the typical pattern rather than failing the whole response,
// so "Current intensity" still reflects real, live data even without one.
async function fetchAtlas(state: string, zone: Zone, key: string): Promise<ProviderResult> {
  const headers = { "X-API-Key": key, accept: "application/json" };

  const [zoneData, liveForecast] = await Promise.all([
    getZoneSnapshot(zone, { allowUpstream: true }),
    FORECAST_ENABLED ? fetchStateForecast(state, headers) : Promise.resolve([] as ForecastPoint[]),
  ]);

  let forecast: ForecastPoint[] = liveForecast;
  let forecastIsTypical = false;
  if (forecast.length === 0 && zoneData.snapshot?.pattern) {
    forecast = projectTypicalForecast(zoneData.snapshot.pattern);
    forecastIsTypical = true;
  }

  // A stale snapshot's pattern is fine, but an old reading isn't "right now".
  let latest = zoneData.snapshot && isFresh(zoneData.snapshot) ? zoneData.snapshot.latest : null;
  // With nothing at all to show, try the all-India reading — unless the quota
  // is spent (a 429, or today's budget), when another call can only fail.
  if (!latest && !forecast.length) {
    if (zoneData.status === 429 || !(await spendAtlasCall())) return { message: "Live grid data is temporarily unavailable.", status: 429 };
    const nationalResponse = await fetch(`${ATLAS_URL}/carbon-intensity/latest`, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }).catch(() => null);
    if (!nationalResponse?.ok) return { message: "Live grid data is temporarily unavailable.", status: nationalResponse?.status === 429 ? 429 : 502 };
    const nationalPayload = await nationalResponse.json();
    latest = parseLatestItem(completeItems(Array.isArray(nationalPayload?.data?.items) ? nationalPayload.data.items : [])[0]);
  }
  if (!latest && !forecast.length) return { message: "Live grid data is temporarily unavailable.", status: 502 };

  // Without a current reading the app still has the typical day to plan with.
  const current = latest ? { carbonIntensity: latest.carbon_intensity_gco2_kwh, datetime: latest.timestamp, isEstimated: true, intensityClass: latest.intensity_class } : undefined;
  const updatedAt = latest?.timestamp ?? (zoneData.snapshot ? new Date(zoneData.snapshot.fetchedAt).toISOString() : undefined);
  return { data: { available: true, state, ...(current ? { current } : {}), forecast, forecastIsTypical, updatedAt, source: ATLAS }, message: "", status: 0 };
}

async function fetchElectricityMaps(state: string, coordinates: { lat: number; lon: number }, key: string): Promise<ProviderResult> {
  const query = `lat=${coordinates.lat}&lon=${coordinates.lon}`;
  const headers = { "auth-token": key, accept: "application/json" };
  const [latestResponse, forecastResponse] = await Promise.all([
    fetch(`${ELECTRICITY_MAPS_URL}/carbon-intensity/latest?${query}`, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }),
    fetch(`${ELECTRICITY_MAPS_URL}/carbon-intensity/forecast?${query}`, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) }),
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
  // Upstream numbers go straight to the screen, so drop any that aren't
  // real readings rather than show "NaN gCO₂/kWh".
  const isReading = (point: unknown): point is { carbonIntensity: number; datetime: string } => Boolean(point && typeof point === "object" && Number.isFinite((point as { carbonIntensity?: unknown }).carbonIntensity) && typeof (point as { datetime?: unknown }).datetime === "string");
  const forecast = Array.isArray(rawForecast) ? rawForecast.filter(isReading).map((point) => ({ datetime: point.datetime, carbonIntensity: point.carbonIntensity })) : [];
  const current = isReading(latest) ? { carbonIntensity: latest.carbonIntensity, datetime: latest.datetime, isEstimated: Boolean((latest as { isEstimated?: unknown }).isEstimated) } : undefined;
  if (!current && !forecast.length) return { message: "Live grid data is temporarily unavailable.", status: 502 };
  return { data: { available: true, state, ...(current ? { current } : {}), forecast, updatedAt: forecastPayload.updatedAt || latest.updatedAt, source: ELECTRICITY_MAPS }, message: "", status: 0 };
}

// Grid data for a state: try each configured provider in order and use the
// first that works, so a broken/limited key falls through to the next.
export async function getGridData(state: string): Promise<ProviderResult & { cacheHit?: boolean }> {
  const cached = cache.get(state);
  if (cached && cached.expiresAt > Date.now()) return { data: cached.payload, message: "", status: 0, cacheHit: true };
  const { zone, lat, lon } = STATES[state];
  const atlasKey = process.env.INDIA_ENERGY_ATLAS_API_KEY;
  const electricityMapsKey = process.env.ELECTRICITY_MAPS_API_KEY;
  if (!atlasKey && !electricityMapsKey) return { message: "Live grid data is not configured yet.", status: 503 };
  try {
    let last: ProviderResult = { message: "Live grid data is temporarily unavailable.", status: 502 };
    if (atlasKey) {
      const result = await fetchAtlas(state, zone, atlasKey);
      if (result.data) { cache.set(state, { expiresAt: Date.now() + CACHE_TTL_MS, payload: result.data }); return result; }
      last = result;
    }
    if (electricityMapsKey) {
      const result = await fetchElectricityMaps(state, { lat, lon }, electricityMapsKey);
      if (result.data) { cache.set(state, { expiresAt: Date.now() + CACHE_TTL_MS, payload: result.data }); return result; }
      last = result;
    }
    return last;
  } catch {
    return { message: "Could not connect to the live grid service.", status: 502 };
  }
}

export function isValidState(raw: string | null): raw is string {
  // `raw in STATES` or `STATES[raw]` would also match inherited Object.prototype
  // keys (e.g. ?state=constructor or ?state=__proto__), reaching the provider
  // fetches with bogus coordinates and burning the shared, rate-limited API
  // quota on garbage requests. Require an exact, own-property match instead.
  return Boolean(raw) && Object.hasOwn(STATES, raw!);
}
