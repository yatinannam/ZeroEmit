import { NextRequest, NextResponse } from "next/server";
import { isUuid, leaderboardConfigured, parseMemberBody, removeMember, submitMember } from "../../../lib/server/leaderboard";

const NOT_CONFIGURED = { error: "The leaderboard isn't set up on this server." };
const MAX_BODY_BYTES = 16_384; // 100 charges is ~8 KB

async function readJson(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Join, or update this month's score. The server recomputes the score from
// the charges; the key proves this device owns the entry.
export async function POST(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const input = parseMemberBody(await readJson(request));
  if (!input) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const result = await submitMember(input);
    if (!result.ok) return NextResponse.json({ error: result.status === 403 ? "Not your entry" : "Too many updates" }, { status: result.status });
    return NextResponse.json({ rank: result.rank, points: result.points, co2Kg: result.co2Kg });
  } catch {
    return NextResponse.json({ error: "Couldn't update the leaderboard" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const body = await readJson(request) as { id?: unknown; key?: unknown } | null;
  if (!isUuid(body?.id) || !isUuid(body?.key)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const result = await removeMember(body.id, body.key);
    if (result === "forbidden") return NextResponse.json({ error: "Not your entry" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't leave the leaderboard" }, { status: 502 });
  }
}
