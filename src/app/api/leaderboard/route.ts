import { NextRequest, NextResponse } from "next/server";
import { isUuid, isZone, leaderboardConfigured, readLeaderboard } from "../../lib/server/leaderboard";

// Not cached by Next itself: route handlers aren't by default in this Next.js version, and
// the board changes whenever anyone logs a charge.
// The anonymous board (no `me`) is the same for everyone, so the CDN may keep
// it for a few seconds — a burst of visitors costs one Redis read, not one
// each. A request with `me` carries that member's own row and is never shared.
const PUBLIC_CACHE = "public, s-maxage=10, stale-while-revalidate=30";

export async function GET(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json({ error: "The leaderboard isn't set up on this server." }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const scope = params.get("scope") ?? "all";
  const me = params.get("me");
  if (scope !== "all" && !isZone(scope)) return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  if (me !== null && !isUuid(me)) return NextResponse.json({ error: "Invalid member" }, { status: 400 });
  try {
    return NextResponse.json(await readLeaderboard(scope, me), { headers: { "Cache-Control": me === null ? PUBLIC_CACHE : "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load the leaderboard" }, { status: 502 });
  }
}
