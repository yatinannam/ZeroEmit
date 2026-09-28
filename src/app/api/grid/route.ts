import { NextRequest, NextResponse } from "next/server";
import { getGridData, isValidState } from "../../lib/server/grid-source";

// Only the state is sent by the client — the user's own city/coordinates
// never leave the device, and the state is all the data needs.
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  if (!isValidState(state)) return NextResponse.json({ available: false, error: "Unsupported location", forecast: [] }, { status: 400 });
  const result = await getGridData(state);
  if (result.data) return NextResponse.json(result.data, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600", "X-Cache": result.cacheHit ? "HIT" : "MISS" } });
  return NextResponse.json({ available: false, state, forecast: [], source: "Live grid provider", error: result.message }, { status: result.status || 503 });
}
