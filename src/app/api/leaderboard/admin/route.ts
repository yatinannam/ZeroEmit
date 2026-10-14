import { NextRequest, NextResponse } from "next/server";
import { readLimitedJson } from "../../../lib/server/http";
import { isZone, leaderboardConfigured, removeMembersByName } from "../../../lib/server/leaderboard";
import { isAuthorizedCron } from "../../../lib/server/push";

// Removes this month's leaderboard entries by display name and region — for
// an entry whose device can no longer leave, or an offensive name. Needs the
// same `Authorization: Bearer <CRON_SECRET>` as the push scheduler.
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!leaderboardConfigured) return NextResponse.json({ error: "The leaderboard isn't set up on this server." }, { status: 503 });
  const body = await readLimitedJson(request, 1024) as { name?: unknown; zone?: unknown } | null;
  if (typeof body?.name !== "string" || body.name.trim().length < 1 || body.name.length > 40 || !isZone(body.zone)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json({ removed: await removeMembersByName(body.name, body.zone) });
  } catch {
    return NextResponse.json({ error: "Couldn't update the leaderboard" }, { status: 502 });
  }
}
