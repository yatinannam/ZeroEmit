import { NextRequest, NextResponse } from "next/server";
import { isUuid, isZone, leaderboardConfigured, readLeaderboard } from "../../lib/server/leaderboard";

// Not cached: route handlers aren't by default in this Next.js version, and
// the board changes whenever anyone logs a charge.
export async function GET(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json({ error: "The leaderboard isn't set up on this server." }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const scope = params.get("scope") ?? "all";
  const me = params.get("me");
  if (scope !== "all" && !isZone(scope)) return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  if (me !== null && !isUuid(me)) return NextResponse.json({ error: "Invalid member" }, { status: 400 });
  try {
    return NextResponse.json(await readLeaderboard(scope, me), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load the leaderboard" }, { status: 502 });
  }
}
