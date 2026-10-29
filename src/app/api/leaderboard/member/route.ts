import { NextRequest, NextResponse } from "next/server";
import { validateDisplayName } from "../../../lib/leaderboard";
import { readLimitedJson } from "../../../lib/server/http";
import { getZoneSnapshot } from "../../../lib/server/grid-source";
import { isUuid, leaderboardConfigured, parseMemberBody, removeMember, submitMember } from "../../../lib/server/leaderboard";

const NOT_CONFIGURED = { error: "The leaderboard isn't set up on this server." };
const MAX_BODY_BYTES = 16_384; // 100 charges is ~8 KB

const SUBMIT_ERRORS = { 403: "Not your entry", 409: "That name is already on this month's leaderboard", 410: "This entry has left the leaderboard", 429: "Too many updates" };

// Join, or update this month's score. The server recomputes the score from
// the charges; the key proves this device owns the entry.
export async function POST(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const body = await readLimitedJson(request, MAX_BODY_BYTES);
  const input = parseMemberBody(body);
  if (!input) {
    // `code: "name"` lets the app blame the name only when the name is the problem.
    const badName = body !== null && typeof body === "object" && !validateDisplayName((body as { name?: unknown }).name);
    return NextResponse.json(badName ? { error: "Invalid name", code: "name" } : { error: "Invalid request" }, { status: 400 });
  }
  try {
    // On Vercel the first x-forwarded-for entry is the client's address.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip");
    // The region's typical day, from cached grid data only (no provider call),
    // so the server judges each charge's timing itself.
    const pattern = await getZoneSnapshot(input.zone, { allowUpstream: false }).then(({ snapshot }) => snapshot?.pattern ?? null).catch(() => null);
    const result = await submitMember(input, Date.now(), ip, pattern);
    if (!result.ok) return NextResponse.json({ error: SUBMIT_ERRORS[result.status], ...(result.status === 409 ? { code: "name-taken" } : {}) }, { status: result.status });
    return NextResponse.json({ rank: result.rank, points: result.points, co2Kg: result.co2Kg });
  } catch {
    return NextResponse.json({ error: "Couldn't update the leaderboard" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const body = await readLimitedJson(request, MAX_BODY_BYTES) as { id?: unknown; key?: unknown } | null;
  if (!isUuid(body?.id) || !isUuid(body?.key)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const result = await removeMember(body.id, body.key);
    if (result === "forbidden") return NextResponse.json({ error: "Not your entry" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't leave the leaderboard" }, { status: 502 });
  }
}
