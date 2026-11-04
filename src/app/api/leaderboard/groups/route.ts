import { NextRequest, NextResponse } from "next/server";
import { parseGroupCode, validateGroupName } from "../../../lib/groups";
import { fromOwnSite, readLimitedJson } from "../../../lib/server/http";
import { createGroup, joinGroup, leaveGroup, listMemberGroups, readGroupBoard, type GroupError } from "../../../lib/server/groups";
import { isUuid, leaderboardConfigured } from "../../../lib/server/leaderboard";
import { redis } from "../../../lib/server/redis";

const NOT_CONFIGURED = { error: "The leaderboard isn't set up on this server." };
// Same short CDN cache as the public board for a board read without `me`.
const PUBLIC_CACHE = "public, s-maxage=10, stale-while-revalidate=30";
// Codes that match no group, per address per hour, before board reads are
// refused: plenty for typos, far too few to find a group by guessing.
const MISSES_PER_HOUR = 30;

// `code` is what the app reads to say what went wrong.
const ERRORS: Record<GroupError, { status: number; error: string }> = {
  "not-member": { status: 404, error: "Join the leaderboard first" },
  forbidden: { status: 403, error: "Not your entry" },
  "no-group": { status: 404, error: "No group has that code" },
  "too-many": { status: 409, error: "Already in the most groups allowed" },
  full: { status: 409, error: "That group is full" },
  rate: { status: 429, error: "Too many tries" },
};
const failure = (error: GroupError) => NextResponse.json({ error: ERRORS[error].error, code: error }, { status: ERRORS[error].status });

// On Vercel the first x-forwarded-for entry is the client's address.
const clientIp = (request: NextRequest) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip");

// GET ?code=ABC234[&me=<id>]: the group's board this month.
export async function GET(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const params = request.nextUrl.searchParams;
  const me = params.get("me");
  const code = parseGroupCode(params.get("code"));
  if (!code) return NextResponse.json({ error: "Invalid group code" }, { status: 400 });
  if (me !== null && !isUuid(me)) return NextResponse.json({ error: "Invalid member" }, { status: 400 });
  try {
    const ip = clientIp(request);
    const missKey = ip ? `lb:gmiss:${ip}:${Math.floor(Date.now() / 3_600_000)}` : null;
    if (missKey && Number(await redis<string | null>("GET", missKey) ?? 0) >= MISSES_PER_HOUR) return failure("rate");
    const board = await readGroupBoard(code, me);
    if (!board) {
      if (missKey && (await redis<number>("INCR", missKey)) === 1) await redis("EXPIRE", missKey, 3600);
      return failure("no-group");
    }
    return NextResponse.json(board, { headers: { "Cache-Control": me === null ? PUBLIC_CACHE : "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load the group" }, { status: 502 });
  }
}

// { action: "list" | "create" | "join" | "leave", id, key, name?, code? }.
// `id` and `key` are the device's leaderboard entry (only its key proves it),
// so even the list of a member's groups needs the key.
export async function POST(request: NextRequest) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const body = await readLimitedJson(request, 1024) as { action?: unknown; id?: unknown; key?: unknown; name?: unknown; code?: unknown } | null;
  if (!body || !isUuid(body.id) || !isUuid(body.key)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { id, key } = body;
  try {
    if (body.action === "list") {
      const result = await listMemberGroups(id, key);
      return result.ok ? NextResponse.json({ groups: result.value }, { headers: { "Cache-Control": "no-store" } }) : failure(result.error);
    }
    if (body.action === "create") {
      const name = validateGroupName(body.name);
      if (!name) return NextResponse.json({ error: "Invalid name", code: "name" }, { status: 400 });
      const result = await createGroup(id, key, name);
      return result.ok ? NextResponse.json(result.value) : failure(result.error);
    }
    const code = parseGroupCode(body.code);
    if (!code || (body.action !== "join" && body.action !== "leave")) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    if (body.action === "join") {
      const result = await joinGroup(id, key, code);
      return result.ok ? NextResponse.json(result.value) : failure(result.error);
    }
    const result = await leaveGroup(id, key, code);
    return result.ok ? NextResponse.json({ ok: true }) : failure(result.error);
  } catch {
    return NextResponse.json({ error: "Couldn't update the group" }, { status: 502 });
  }
}
