import { NextRequest, NextResponse } from "next/server";
import { chargerOrigin, stationsAround } from "../../lib/stations";
import snapshot from "../../lib/server/chargers-india.json";

// Chargers near the user's position (?lat=&lon=, rounded to ~1 km) or, without
// one, near a listed city's centre (?state=&city=), nearest first — picked
// from the bundled OpenStreetMap snapshot, so it answers in milliseconds.
// With none in range, `farther` has the nearest 3 beyond it (else it's empty).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const resolved = chargerOrigin({ lat: params.get("lat"), lon: params.get("lon"), city: params.get("city"), state: params.get("state") });
  if (!resolved) return NextResponse.json({ error: "Unknown place" }, { status: 400 });
  const { origin, source } = resolved;
  const { stations, farther } = stationsAround(snapshot.elements, origin);
  return NextResponse.json({ stations, farther, origin, source, updatedAt: snapshot.updatedAt }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
}
