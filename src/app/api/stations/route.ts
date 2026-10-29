import { NextRequest, NextResponse } from "next/server";
import { knownPlaceCoordinates } from "../../lib/places";
import { overpassQuery, parseOverpass, type Station } from "../../lib/stations";
import { firstOverpassAnswer, OVERPASS_SERVERS } from "../../lib/server/overpass";
import { redis, redisConfigured } from "../../lib/server/redis";

export const maxDuration = 30;

const CACHE_S = 24 * 60 * 60; // chargers don't move; spare the free service
const memory = new Map<string, { at: number; stations: Station[] }>();

// Chargers near one of the app's listed cities (its centre — never the
// user's GPS position), nearest first.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const place = { name: params.get("city") ?? "", state: params.get("state") ?? "" };
  const origin = knownPlaceCoordinates(place);
  if (!origin) return NextResponse.json({ error: "Unknown city" }, { status: 400 });
  const key = `stations:${place.state}:${place.name}`;
  const headers = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };

  const cached = memory.get(key);
  if (cached && Date.now() - cached.at < CACHE_S * 1000) return NextResponse.json({ stations: cached.stations, origin }, { headers });
  if (redisConfigured) {
    const stored = await redis<string | null>("GET", key).catch(() => null);
    if (stored) { const stations = JSON.parse(stored) as Station[]; memory.set(key, { at: Date.now(), stations }); return NextResponse.json({ stations, origin }, { headers }); }
  }

  const response = await firstOverpassAnswer(OVERPASS_SERVERS, overpassQuery(origin));
  if (response === null) return NextResponse.json({ error: "Charger data is unavailable right now" }, { status: 502 });
  const stations = parseOverpass(response, origin);
  memory.set(key, { at: Date.now(), stations });
  if (redisConfigured) await redis("SET", key, JSON.stringify(stations), "EX", CACHE_S).catch(() => undefined);
  return NextResponse.json({ stations, origin }, { headers });
}
