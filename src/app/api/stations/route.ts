import { NextRequest, NextResponse } from "next/server";
import { chargerOrigin, overpassQuery, parseOverpass, type Station } from "../../lib/stations";
import { firstOverpassAnswer, OVERPASS_SERVERS } from "../../lib/server/overpass";
import { redis, redisConfigured } from "../../lib/server/redis";

export const maxDuration = 30;

const CACHE_S = 24 * 60 * 60; // chargers don't move; spare the free service
const memory = new Map<string, { at: number; stations: Station[] }>();

// Chargers near the user's position (?lat=&lon=, rounded to ~1 km) or, without
// one, near a listed city's centre (?state=&city=), nearest first. Results are
// cached per rounded area or city, never per user.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const resolved = chargerOrigin({ lat: params.get("lat"), lon: params.get("lon"), city: params.get("city"), state: params.get("state") });
  if (!resolved) return NextResponse.json({ error: "Unknown place" }, { status: 400 });
  const { origin, key, source } = resolved;
  const headers = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
  const reply = (stations: Station[]) => NextResponse.json({ stations, origin, source }, { headers });

  const cached = memory.get(key);
  if (cached && Date.now() - cached.at < CACHE_S * 1000) return reply(cached.stations);
  if (redisConfigured) {
    const stored = await redis<string | null>("GET", key).catch(() => null);
    if (stored) { const stations = JSON.parse(stored) as Station[]; memory.set(key, { at: Date.now(), stations }); return reply(stations); }
  }

  const response = await firstOverpassAnswer(OVERPASS_SERVERS, overpassQuery(origin));
  if (response === null) return NextResponse.json({ error: "Charger data is unavailable right now" }, { status: 502 });
  const stations = parseOverpass(response, origin);
  memory.set(key, { at: Date.now(), stations });
  if (redisConfigured) await redis("SET", key, JSON.stringify(stations), "EX", CACHE_S).catch(() => undefined);
  return reply(stations);
}
