import { NextRequest, NextResponse } from "next/server";
import { knownPlaceCoordinates } from "../../lib/places";
import { overpassQuery, parseOverpass, type Station } from "../../lib/stations";
import { redis, redisConfigured } from "../../lib/server/redis";

export const maxDuration = 30;

// Public Overpass servers; the second is tried if the first fails or is busy.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const CACHE_S = 24 * 60 * 60; // chargers don't move; spare the free service
const memory = new Map<string, { at: number; stations: Station[] }>();

async function fromOverpass(query: string) {
  for (const endpoint of OVERPASS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ZeroEmit (https://zero-emit.vercel.app)" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (response.ok) return await response.json() as unknown;
    } catch { /* try the next server */ }
  }
  return null;
}

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

  const response = await fromOverpass(overpassQuery(origin));
  if (response === null) return NextResponse.json({ error: "Charger data is unavailable right now" }, { status: 502 });
  const stations = parseOverpass(response, origin);
  memory.set(key, { at: Date.now(), stations });
  if (redisConfigured) await redis("SET", key, JSON.stringify(stations), "EX", CACHE_S).catch(() => undefined);
  return NextResponse.json({ stations, origin }, { headers });
}
